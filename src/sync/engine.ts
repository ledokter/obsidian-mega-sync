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
import { MegaSyncSettings, FileEntry, SyncSnapshot, SyncResult, SyncOp, FILE_TYPE_PRESETS } from "./types";
import { PathFilter } from "./filter";

const SNAPSHOT_VERSION = 1;
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

  /** Run a full sync cycle. Throws on fatal errors. When `dry` is true, the
   *  plan is computed and logged but no write/delete is performed and the
   *  snapshot is not updated. */
  async run(dry = false): Promise<SyncResult> {
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

    // Build inventories.
    this.logger.info("Building local inventory…");
    const L = await this.local.build();
    this.logger.info(`Local: ${L.size} files.`);

    this.logger.info("Building remote inventory…");
    const R = await this.mega.listRemote();
    this.logger.info(`Remote: ${R.size} files.`);

    // Apply the path filter (always-skipped, hidden/underscore, regex) to both
    // sides so excluded files are simply ignored (left untouched) rather than
    // deleted. The local walk already applied it, but re-applying is cheap and
    // idempotent; for the remote side this is the primary application.
    const pathFilter = new PathFilter(this.settings);
    this.filterByPath(L, pathFilter);
    this.filterByPath(R, pathFilter);
    // Apply the file-type filter likewise.
    this.filterByType(L);
    this.filterByType(R);

    // Load snapshot: prefer the remote one (so multiple devices converge),
    // fall back to the locally cached one.
    let S = await this.mega.readSnapshot();
    if (!S && this.settings.lastSnapshot) {
      S = this.settings.lastSnapshot;
      this.logger.info("Using locally cached snapshot (no remote snapshot yet).");
    }
    const snapshot: SyncSnapshot = S ?? { v: SNAPSHOT_VERSION, savedAt: 0, files: {} };

    // Compute the plan.
    const plan = this.plan(L, R, snapshot.files, this.settings.syncDirection);
    const counts = {
      up: plan.filter((o) => o.type === "upload").length,
      down: plan.filter((o) => o.type === "download").length,
      delR: plan.filter((o) => o.type === "deleteRemote").length,
      delL: plan.filter((o) => o.type === "deleteLocal").length,
      conf: plan.filter((o) => o.type === "conflict").length,
    };
    this.logger.info(
      `Plan: ${plan.length} actions ` +
        `(${counts.up} up, ${counts.down} down, ${counts.delR} del-r, ${counts.delL} del-l, ${counts.conf} conflict).` +
        (dry ? " [DRY RUN — nothing will change]" : ""),
    );
    if (dry) {
      for (const op of plan) {
        this.logger.info(`  [dry] ${op.type.padEnd(12)} ${op.path}  — ${op.reason}`);
      }
    }

    // Safety guard: abort if too many files would change in one run.
    if (!dry) {
      this.guardModifyPercentage(plan, L, R);
    }

    // Execute (skipped in dry-run mode).
    if (!dry) {
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
    } else {
      // Reflect the plan in the dry-run result counts.
      result.uploaded = counts.up;
      result.downloaded = counts.down;
      result.deletedRemote = counts.delR;
      result.deletedLocal = counts.delL;
      result.conflicts = counts.conf;
      result.skipped = plan.filter((o) => o.type === "skip").length;
    }

    result.durationMs = Date.now() - t0;
    this.logger.ok(
      `${dry ? "Dry run" : "Sync"} complete in ${(result.durationMs / 1000).toFixed(1)}s — ` +
        `↑${result.uploaded} ↓${result.downloaded} ` +
        `delR:${result.deletedRemote} delL:${result.deletedLocal} ` +
        `conflicts:${result.conflicts} errors:${result.errors}`,
    );
    return result;
  }

  /** Abort the sync if the share of modifying/deleting ops exceeds the
   *  configured percentage. Protects against mass deletions when one side
   *  appears empty (wrong vault, lost snapshot, …). `100` disables the guard;
   *  the exact-100%/100% case (every file changes) is allowed. */
  private guardModifyPercentage(plan: SyncOp[], L: Map<string, FileEntry>, R: Map<string, RemoteFile>): void {
    const pct = this.settings.protectModifyPercentage;
    if (pct >= 100) return;
    const allFiles = new Set<string>([...L.keys(), ...R.keys()]);
    const total = allFiles.size;
    if (total === 0) return;
    const modifyDelete = plan.filter((o) => o.type !== "skip").length;
    const ratio = (modifyDelete * 100) / total;
    // Special case: if literally everything changes, allow it (legitimate full
    // bootstrap / wipe-and-restore). Otherwise enforce the threshold.
    if (modifyDelete === total) return;
    if (ratio >= pct) {
      const msg =
        `Aborted: ${modifyDelete}/${total} files (${ratio.toFixed(0)}%) would change, ` +
        `exceeding the ${pct}% safety guard. Run a dry run to review, or raise ` +
        `"Max % of files changed per sync" in settings.`;
      this.logger.error(msg);
      throw new Error(msg);
    }
  }

  /** Decide the list of operations given L, R, and the snapshot. The two-way
   *  decision is computed first, then each op is remapped to honour the
   *  configured sync direction (one-way strict mirror). */
  private plan(
    L: Map<string, FileEntry>,
    R: Map<string, RemoteFile>,
    S: Record<string, FileEntry>,
    dir: MegaSyncSettings["syncDirection"],
  ): SyncOp[] {
    const ops: SyncOp[] = [];
    const all = new Set<string>([...L.keys(), ...R.keys(), ...Object.keys(S)]);

    for (const path of all) {
      const l = L.get(path);
      const r = R.get(path);
      const s = S[path];

      const lGone = !l && !!s;
      const rGone = !r && !!s;

      // New local file only.
      if (l && !r && !s) {
        ops.push(this.remap({ type: "upload", path, reason: "new local file" }, l, r, dir));
        continue;
      }
      // New remote file only.
      if (r && !l && !s) {
        ops.push(this.remap({ type: "download", path, reason: "new remote file" }, l, r, dir));
        continue;
      }
      // New on both sides simultaneously -> conflict (keep both).
      if (l && r && !s) {
        ops.push(this.remap({ type: "conflict", path, reason: "new on both sides" }, l, r, dir));
        continue;
      }

      const lChanged = l && s && this.changed(l, s);
      const rChanged = r && s && this.changed({ path, mtime: r.mtime, size: r.size }, s);

      // Deletions.
      if (lGone && r && !rChanged) {
        // Deleted locally, remote unchanged -> delete remote.
        ops.push(this.remap({ type: "deleteRemote", path, reason: "deleted locally" }, l, r, dir));
        continue;
      }
      if (rGone && l && !lChanged) {
        // Deleted remotely, local unchanged -> delete local.
        ops.push(this.remap({ type: "deleteLocal", path, reason: "deleted remotely" }, l, r, dir));
        continue;
      }
      if (lGone && rGone) {
        // Already gone both sides — nothing to do; snapshot entry will be dropped.
        ops.push({ type: "skip", path, reason: "deleted on both sides" });
        continue;
      }

      // Modifications.
      if (lChanged && !rChanged) {
        ops.push(this.remap({ type: "upload", path, reason: "modified locally" }, l, r, dir));
        continue;
      }
      if (rChanged && !lChanged) {
        ops.push(this.remap({ type: "download", path, reason: "modified remotely" }, l, r, dir));
        continue;
      }
      if (lChanged && rChanged) {
        ops.push(this.remap({ type: "conflict", path, reason: "modified on both sides" }, l, r, dir));
        continue;
      }

      // Unchanged both sides.
      ops.push({ type: "skip", path, reason: "unchanged" });
    }

    return ops;
  }

  /** Remap a two-way op for one-way directions.
   *  Strict mirror (deletions propagated): upload-only, download-only.
   *  Non-destructive one-way (no deletions, conflicts left as-is): push-only,
   *  pull-only. Needs `l`/`r` to disambiguate mirror cases where a pull/push
   *  becomes either an overwrite of the target or a deletion of the orphaned
   *  side. */
  private remap(
    op: SyncOp,
    l: FileEntry | undefined,
    r: RemoteFile | undefined,
    dir: MegaSyncSettings["syncDirection"],
  ): SyncOp {
    if (dir === "two-way") return op;
    const { path } = op;

    // Non-destructive one-way: only allow the source-side transfer; skip
    // everything else (no deletions, conflicts left for a two-way run).
    if (dir === "push-only") {
      return op.type === "upload"
        ? op
        : { type: "skip", path, reason: "skipped (push-only, no delete)" };
    }
    if (dir === "pull-only") {
      return op.type === "download"
        ? op
        : { type: "skip", path, reason: "skipped (pull-only, no delete)" };
    }

    if (dir === "upload-only") {
      switch (op.type) {
        case "upload":
          return op; // local -> remote, always allowed
        case "download":
          // Pulling from remote. If a local file exists (remote was modified,
          // local unchanged), local wins -> overwrite remote. If no local file
          // exists (orphan on remote), mirror semantics delete it from remote.
          return l
            ? { type: "upload", path, reason: "local wins (upload-only)" }
            : { type: "deleteRemote", path, reason: "orphan on remote (upload-only)" };
        case "deleteRemote":
          return op; // local deletion propagates to remote
        case "deleteLocal":
          return { type: "skip", path, reason: "never delete local (upload-only)" };
        case "conflict":
          return { type: "upload", path, reason: "local wins (upload-only)" };
        case "skip":
        case "mkdirRemote":
          return op;
      }
    }

    // download-only: remote is the source, local mirrors it.
    switch (op.type) {
      case "download":
        return op; // remote -> local, always allowed
      case "upload":
        // Pushing to remote. If a remote file exists (local was modified,
        // remote unchanged), remote wins -> overwrite local. If no remote file
        // exists (orphan on local), mirror semantics delete it locally.
        return r
          ? { type: "download", path, reason: "remote wins (download-only)" }
          : { type: "deleteLocal", path, reason: "orphan on local (download-only)" };
      case "deleteLocal":
        return op; // remote deletion propagates to local
      case "deleteRemote":
        return { type: "skip", path, reason: "never delete remote (download-only)" };
      case "conflict":
        return { type: "download", path, reason: "remote wins (download-only)" };
      case "skip":
      case "mkdirRemote":
        return op;
    }
  }

  /** Whether `path`'s extension is allowed by the file-type filter. */
  private allowedType(path: string): boolean {
    if (this.settings.fileTypeMode !== "whitelist") return true;
    const allow = new Set<string>();
    const sel: Record<string, boolean> = {
      notes: this.settings.fileTypePresetNotes,
      images: this.settings.fileTypePresetImages,
      pdf: this.settings.fileTypePresetPdf,
      audio: this.settings.fileTypePresetAudio,
      video: this.settings.fileTypePresetVideo,
    };
    for (const k of Object.keys(sel)) {
      if (sel[k]) FILE_TYPE_PRESETS[k].exts.forEach((e) => allow.add(e));
    }
    this.settings.fileTypeCustomExt.split(/[\s,]+/).forEach((e) => {
      if (e) allow.add(e.replace(/^\.+/, "").toLowerCase());
    });
    if (allow.size === 0) return true; // empty whitelist = allow all (anti-wipe)
    const dot = path.lastIndexOf(".");
    if (dot < 0) return false; // no extension -> excluded in whitelist mode
    return allow.has(path.slice(dot + 1).toLowerCase());
  }

  /** Remove disallowed-type entries from an inventory map (in place). */
  private filterByType<K, V extends { path: string }>(m: Map<K, V>): void {
    for (const [k, v] of m) {
      if (!this.allowedType(v.path)) m.delete(k);
    }
  }

  /** Remove entries whose path is skipped by the shared PathFilter (always-
   *  skipped names, hidden/underscore, regex ignore/allow). In place. */
  private filterByPath<K, V extends { path: string }>(m: Map<K, V>, f: PathFilter): void {
    for (const [k, v] of m) {
      if (f.shouldSkip(v.path)) m.delete(k);
    }
  }

  /** Execute a single operation. */
  private async execute(
    op: SyncOp,
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
        const newName = conflictName.split("/").pop();
        if (newName) await this.mega.rename(path, newName);
        R.delete(path);
        result.conflicts++;
        this.logger.warn(`Conflict on "${path}" — kept remote copy as "${conflictName}".`);
      } catch (e) {
        this.logger.error(`Could not rename conflicting remote "${path}".`, e);
        result.errors++;
      }
    }

    // Also keep a local conflict copy of the current local version, so both
    // versions survive on the local side too.
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