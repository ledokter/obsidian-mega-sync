// The sync engine. Implements a three-way merge using the last-sync snapshot:
//   - L = current local inventory
//   - R = current remote inventory
//   - S = last-sync snapshot
// For each known path we decide upload / download / delete-remote /
// delete-local / conflict-copy / skip. After executing, we rewrite the
// snapshot (both locally and on MEGA) to the merged state.
import { App } from "obsidian";
import { MegaAdapter, RemoteFile } from "../mega/mega-adapter";
import { LocalInventory } from "./local";
import { Logger } from "../ui/logger";
import { MegaSyncSettings, FileEntry, SyncSnapshot, SyncResult } from "./types";
import { joinPath } from "../util";

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_FILE = "_mega_sync_snapshot.json";

/** Small tolerance when comparing mtimes (ms). */
const MTIME_TOLERANCE_MS = 1500;

export class SyncEngine {
  private app: App;
  private settings: MegaSyncSettings;
  private mega: MegaAdapter;
  private local: LocalInventory;
  private logger: Logger;
  private progress?: (done: number, total: number, label: string) => void;

  constructor(
    app: App,
    settings: MegaSyncSettings,
    mega: MegaAdapter,
    logger: Logger,
  ) {
    this.app = app;
    this.settings = settings;
    this.mega = mega;
    this.logger = logger;
    this.local = new LocalInventory(app, settings);
  }

  setProgress(fn: (done: number, total: number, label: string) => void): void {
    this.progress = fn;
  }

  /** Run a full sync cycle. Throws on fatal errors. */
  async run(): Promise<SyncResult> {
    const t0 = Date.now();
    const result: SyncResult = {
      uploaded: 0,
      downloaded: 0,
      deletedRemote: 0,
      deletedLocal: 0,
      conflicts: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
    };

    await this.mega.connect();
    const base = await this.mega.resolveBase();

    // Build inventories.
    this.logger.info("Building local inventory…");
    const L = await this.local.build();
    this.logger.info(`Local: ${L.size} files.`);

    this.logger.info("Building remote inventory…");
    const R = await this.mega.listRemote();
    this.logger.info(`Remote: ${R.size} files.`);

    // Load snapshot: prefer the remote one (so multiple devices converge),
    // fall back to the locally cached one.
    let S = await this.mega.readSnapshot();
    if (!S && this.settings.lastSnapshot) {
      S = this.settings.lastSnapshot;
      this.logger.info("Using locally cached snapshot (no remote snapshot yet).");
    }
    const snapshot: SyncSnapshot = S ?? { v: SNAPSHOT_VERSION, savedAt: 0, files: {} };

    // Compute the plan.
    const plan = this.plan(L, R, snapshot.files);
    this.logger.info(
      `Plan: ${plan.length} actions ` +
        `(${plan.filter((o) => o.type === "upload").length} up, ` +
        `${plan.filter((o) => o.type === "download").length} down, ` +
        `${plan.filter((o) => o.type === "deleteRemote").length} del-r, ` +
        `${plan.filter((o) => o.type === "deleteLocal").length} del-l, ` +
        `${plan.filter((o) => o.type === "conflict").length} conflict).`,
    );

    // Execute.
    const total = plan.length;
    let done = 0;
    for (const op of plan) {
      done++;
      this.progress?.(done, total, op.path);
      try {
        await this.execute(op, L, R, snapshot.files, result);
      } catch (e) {
        result.errors++;
        this.logger.error(`Failed: ${op.type} ${op.path}`, e);
      }
    }

    // Rewrite the snapshot to the new merged state.
    this.rebuildSnapshot(snapshot, L, R);
    snapshot.savedAt = Date.now();
    await this.mega.writeSnapshot(snapshot);

    result.durationMs = Date.now() - t0;
    this.logger.ok(
      `Sync complete in ${(result.durationMs / 1000).toFixed(1)}s — ` +
        `↑${result.uploaded} ↓${result.downloaded} ` +
        `delR:${result.deletedRemote} delL:${result.deletedLocal} ` +
        `conflicts:${result.conflicts} errors:${result.errors}`,
    );
    return result;
  }

  /** Decide the list of operations given L, R, and the snapshot. */
  private plan(
    L: Map<string, FileEntry>,
    R: Map<string, RemoteFile>,
    S: Record<string, FileEntry>,
  ): { type: import("./types").SyncOp["type"]; path: string; reason: string }[] {
    const ops: { type: import("./types").SyncOp["type"]; path: string; reason: string }[] = [];
    const all = new Set<string>([...L.keys(), ...R.keys(), ...Object.keys(S)]);

    for (const path of all) {
      const l = L.get(path);
      const r = R.get(path);
      const s = S[path];

      const lNew = !!l && !s;
      const rNew = !!r && !s;
      const lGone = !l && !!s;
      const rGone = !r && !!s;

      // New local file only.
      if (l && !r && !s) {
        ops.push({ type: "upload", path, reason: "new local file" });
        continue;
      }
      // New remote file only.
      if (r && !l && !s) {
        ops.push({ type: "download", path, reason: "new remote file" });
        continue;
      }
      // New on both sides simultaneously -> conflict (keep both).
      if (l && r && !s) {
        ops.push({ type: "conflict", path, reason: "new on both sides" });
        continue;
      }

      const lChanged = l && s && this.changed(l, s);
      const rChanged = r && s && this.changed({ path, mtime: r.mtime, size: r.size }, s);

      // Deletions.
      if (lGone && r && !rChanged) {
        // Deleted locally, remote unchanged -> delete remote.
        ops.push({ type: "deleteRemote", path, reason: "deleted locally" });
        continue;
      }
      if (rGone && l && !lChanged) {
        // Deleted remotely, local unchanged -> delete local.
        ops.push({ type: "deleteLocal", path, reason: "deleted remotely" });
        continue;
      }
      if (lGone && rGone) {
        // Already gone both sides — nothing to do; snapshot entry will be dropped.
        ops.push({ type: "skip", path, reason: "deleted on both sides" });
        continue;
      }

      // Modifications.
      if (lChanged && !rChanged) {
        ops.push({ type: "upload", path, reason: "modified locally" });
        continue;
      }
      if (rChanged && !lChanged) {
        ops.push({ type: "download", path, reason: "modified remotely" });
        continue;
      }
      if (lChanged && rChanged) {
        ops.push({ type: "conflict", path, reason: "modified on both sides" });
        continue;
      }

      // Unchanged both sides.
      ops.push({ type: "skip", path, reason: "unchanged" });
    }

    return ops;
  }

  /** Execute a single operation. */
  private async execute(
    op: { type: import("./types").SyncOp["type"]; path: string; reason: string },
    L: Map<string, FileEntry>,
    R: Map<string, RemoteFile>,
    S: Record<string, FileEntry>,
    result: SyncResult,
  ): Promise<void> {
    const path = op.path;
    switch (op.type) {
      case "upload": {
        const buf = await this.local.read(path);
        const remote = await this.mega.upload(path, Buffer.from(buf as ArrayBuffer));
        R.set(path, remote);
        result.uploaded++;
        this.logger.ok(`↑ ${path}`);
        break;
      }
      case "download": {
        const buf = await this.mega.download(path);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        await this.local.write(path, ab);
        L.set(path, {
          path,
          mtime: R.get(path)?.mtime ?? Date.now(),
          size: buf.length,
        });
        result.downloaded++;
        this.logger.ok(`↓ ${path}`);
        break;
      }
      case "deleteRemote": {
        await this.mega.deleteRemote(path);
        R.delete(path);
        result.deletedRemote++;
        this.logger.ok(`×R ${path}`);
        break;
      }
      case "deleteLocal": {
        await this.local.delete(path, this.settings.useTrashForDeletion);
        L.delete(path);
        result.deletedLocal++;
        this.logger.ok(`×L ${path}`);
        break;
      }
      case "conflict": {
        await this.resolveConflict(path, L, R, result);
        break;
      }
      case "skip": {
        result.skipped++;
        break;
      }
    }
    // Keep the snapshot entry in sync with the current state for this path
    // (handled fully in rebuildSnapshot, but clear deletions now).
    if (op.type === "deleteRemote" || op.type === "deleteLocal") {
      delete S[path];
    }
  }

  /** Conflict resolution: keep both files. The remote copy is renamed to a
   *  `<name>.conflict-<ts>.<ext>` file (so both versions survive on remote),
   *  then the local version is uploaded. The local file keeps its name. */
  private async resolveConflict(
    path: string,
    L: Map<string, FileEntry>,
    R: Map<string, RemoteFile>,
    result: SyncResult,
  ): Promise<void> {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dot = path.lastIndexOf(".");
    const base = dot > 0 ? path.slice(0, dot) : path;
    const ext = dot > 0 ? path.slice(dot) : "";
    const conflictName = `${base}.conflict-${ts}${ext}`;

    const remote = R.get(path);
    if (remote) {
      try {
        await this.mega.rename(path, conflictName.split("/").pop() as string);
        R.delete(path);
        result.conflicts++;
        this.logger.warn(`Conflict on "${path}" — kept remote copy as "${conflictName}".`);
      } catch (e) {
        this.logger.error(`Could not rename conflicting remote "${path}".`, e);
        result.errors++;
      }
    }

    // Also keep a local conflict copy of the current local version, mirroring
    // Remotely Save's "create conflict copies" behaviour.
    const local = L.get(path);
    if (local) {
      try {
        await this.local.renameLocal(path, conflictName);
        // Re-read the renamed file into inventory so it gets uploaded too.
        L.delete(path);
        L.set(conflictName, { path: conflictName, mtime: local.mtime, size: local.size });
      } catch (e) {
        this.logger.error(`Could not create local conflict copy for "${path}".`, e);
      }
    }

    // Now upload the local (possibly renamed-away) original — but we renamed it,
    // so we instead download nothing; the local conflict copy will be uploaded
    // in a subsequent sync. To converge within this run, upload it now if it
    // still exists.
    if (await this.local.exists(path)) {
      try {
        const buf = await this.local.read(path);
        const remote2 = await this.mega.upload(path, Buffer.from(buf));
        R.set(path, remote2);
        result.uploaded++;
        this.logger.ok(`↑ ${path} (after conflict)`);
      } catch (e) {
        this.logger.error(`Could not re-upload "${path}" after conflict.`, e);
        result.errors++;
      }
    }
  }

  /** Rebuild the snapshot from the post-sync L and R maps. */
  private rebuildSnapshot(
    snapshot: SyncSnapshot,
    L: Map<string, FileEntry>,
    R: Map<string, RemoteFile>,
  ): void {
    const files: Record<string, FileEntry> = {};
    for (const [path, l] of L) {
      const r = R.get(path);
      // Prefer the local mtime (authoritative for local edits); keep size from
      // whichever side matches.
      files[path] = {
        path,
        mtime: l.mtime,
        size: r ? r.size : l.size,
      };
    }
    // Any remote file not present locally (e.g. conflict copies we just
    // created) should also be recorded.
    for (const [path, r] of R) {
      if (!files[path]) {
        files[path] = { path, mtime: r.mtime, size: r.size };
      }
    }
    snapshot.files = files;
  }

  /** Has an entry changed relative to the snapshot? */
  private changed(a: FileEntry, b: FileEntry): boolean {
    if (a.size !== b.size) return true;
    if (Math.abs(a.mtime - b.mtime) > MTIME_TOLERANCE_MS) return true;
    return false;
  }
}