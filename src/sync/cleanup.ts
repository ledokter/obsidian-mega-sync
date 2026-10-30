// "Clean up conflict copies": collapse the `.conflict-<ts>` duplicates that
// the keep-both conflict mode stacks up into a single merged file, on BOTH the
// local vault and the MEGA cloud.
//
// Each conflict group is the base file (`notes.md`) plus its `.conflict-<ts>`
// copies. We sort them oldest → newest by the timestamp embedded in the name,
// then:
//   - Text files (md/markdown/txt): sequential three-way merge, the base file
//     participating as the starting point, the merge-cache ancestor (the real
//     last-synced content) as the common base when available. All non-
//     overlapping edits are preserved. If any merge is unclean, the newest
//     version wins that file (safe — no edits are silently dropped).
//   - Binary files: newest wins.
// The winner is written as the base file locally and uploaded to MEGA, every
// `.conflict-*` copy is deleted on both sides, and the snapshot is updated so
// the next sync sees a single in-sync file.
import { App } from "obsidian";
import { MegaAdapter, RemoteFile } from "../mega/mega-adapter";
import { LocalInventory } from "./local";
import { Logger } from "../ui/logger";
import { MergeCache } from "./mergeCache";
import { MegaSyncSettings, FileEntry, SyncSnapshot, SnapshotEntry, normalizeSnapshot } from "./types";
import { attemptTextMerge, isMergeableText } from "./textMerge";
import { hashContent } from "./hash";

const SNAPSHOT_VERSION = 2;

/** Matches a conflict copy: `<base>.conflict-<tag><ext>`, where `<tag>` is
 *  either the wall-clock stamp written by the legacy keep-both mode
 *  (`2026-10-30T12-34-56-789Z` — `:` and `.` replaced by `-`) or the content
 *  hash tag written by the current one (see engine.ts). */
const CONFLICT_RE = /^(.*)\.conflict-([0-9a-f]{12}|\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d+)?Z?)(.*)$/;

interface Version {
  /** Vault-relative path of this version (the base path, or a conflict copy). */
  path: string;
  /** Ordering key, oldest → newest. For legacy names this is the timestamp
   *  embedded in the name; for hash-based names it is the file's mtime from
   *  the inventory (the name carries no time info). -1 for the base file. */
  ts: number;
  /** True for the base file itself (the version that survives as the winner). */
  isBase: boolean;
}

interface ConflictGroup {
  /** The base path the copies collapse into (e.g. `notes.md`). */
  base: string;
  /** All versions sorted oldest → newest. */
  versions: Version[];
}

export interface CleanupPlan {
  groups: ConflictGroup[];
  /** Number of conflict copies that will be deleted (local + remote). */
  copiesToDelete: number;
  /** Files that will be merged (text) vs. newest-wins (binary). */
  mergeable: number;
}

export interface CleanupResult {
  groups: number;
  merged: number;
  newestWins: number;
  deletedLocal: number;
  deletedRemote: number;
  errors: number;
}

/** Parse the legacy wall-clock stamp in a conflict name into epoch ms. The
 *  stamp is `YYYY-MM-DDTHH-MM-SS[-frac]Z` (the ISO string with `:` and `.`
 *  replaced by `-`), so reconstruct the separators before parsing. Returns 0
 *  for hash-based tags (which carry no time). */
function parseTs(tag: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d+))?Z?$/.exec(tag);
  if (!m) return 0;
  const frac = m[5] ? "." + m[5] : "";
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}${frac}Z`;
  const t = Date.parse(iso);
  return isNaN(t) ? 0 : t;
}

export class ConflictCleanup {
  constructor(
    private app: App,
    private settings: MegaSyncSettings,
    private mega: MegaAdapter,
    private logger: Logger,
    private mergeCache: MergeCache,
    private local: LocalInventory,
  ) {}

  /** Scan local + remote inventories and group every `.conflict-*` copy with
   *  its base file. A group is only actionable when at least one version
   *  exists on disk (the base, or a copy we can read). */
  async scan(L: Map<string, FileEntry>, R: Map<string, RemoteFile>): Promise<CleanupPlan> {
    const byBase = new Map<string, Version[]>();

    const addVersion = (path: string) => {
      const m = CONFLICT_RE.exec(path);
      if (!m) return;
      const base = m[1] + m[3];
      // Legacy names carry an ISO timestamp; hash-based names carry none, so
      // fall back to the file's mtime from the inventory for ordering.
      const ts = parseTs(m[2]) || L.get(path)?.mtime || R.get(path)?.mtime || 0;
      const list = byBase.get(base) ?? [];
      list.push({ path, ts, isBase: false });
      byBase.set(base, list);
    };

    for (const path of L.keys()) addVersion(path);
    for (const path of R.keys()) addVersion(path);

    const groups: ConflictGroup[] = [];
    let copiesToDelete = 0;
    let mergeable = 0;

    for (const [base, versions] of byBase) {
      versions.sort((a, b) => a.ts - b.ts);
      // The base file participates as the oldest version (it is the current
      // on-disk state the copies were split off from).
      const baseExists = L.has(base) || R.has(base);
      if (baseExists) versions.unshift({ path: base, ts: -1, isBase: true });
      groups.push({ base, versions });
      copiesToDelete += versions.filter((v) => !v.isBase).length;
      if (isMergeableText(base, 1)) mergeable++;
    }

    return { groups, copiesToDelete, mergeable };
  }

  /** Apply the cleanup: merge/collapse each group, write the winner as the base
   *  file on both sides, delete every conflict copy on both sides, update the
   *  snapshot. `merge` = sequential three-way merge (preserve all edits);
   *  `false` = newest-only. `dry` = preview only. */
  async apply(plan: CleanupPlan, L: Map<string, FileEntry>, R: Map<string, RemoteFile>, merge: boolean, dry: boolean): Promise<CleanupResult> {
    const result: CleanupResult = { groups: 0, merged: 0, newestWins: 0, deletedLocal: 0, deletedRemote: 0, errors: 0 };

    for (const g of plan.groups) {
      result.groups++;
      const newest = g.versions[g.versions.length - 1];

      let winnerContent: ArrayBuffer | undefined;
      let winnerPath = newest.path;

      if (merge && isMergeableText(g.base, 1)) {
        const merged = await this.mergeGroup(g, L, R);
        if (merged) {
          winnerContent = merged;
          winnerPath = g.base;
          result.merged++;
        } else {
          winnerContent = await this.readVersion(newest.path, L, R);
          result.newestWins++;
        }
      } else {
        winnerContent = await this.readVersion(newest.path, L, R);
        result.newestWins++;
      }

      if (!winnerContent) {
        this.logger.warn(`Cleanup: no readable content for "${g.base}" — skipping group.`);
        result.errors++;
        continue;
      }

      if (dry) {
        this.logger.info(`  [dry] collapse "${g.base}" (${g.versions.length} versions → 1)`);
        continue;
      }

      try {
        // Write the winner as the base file locally.
        const realMtime = await this.local.write(g.base, winnerContent);
        const hash = await hashContent(winnerContent, this.settings.verifyContentHash);
        L.set(g.base, { path: g.base, mtime: realMtime, size: winnerContent.byteLength, hash });

        // Upload the winner to MEGA.
        const remote = await this.mega.upload(g.base, Buffer.from(winnerContent));
        R.set(g.base, { ...remote, hash });

        // Delete every conflict copy on both sides.
        for (const v of g.versions) {
          if (v.isBase) continue;
          if (L.has(v.path)) {
            await this.local.delete(v.path, this.settings.useTrashForDeletion);
            L.delete(v.path);
            result.deletedLocal++;
          }
          if (R.has(v.path)) {
            await this.mega.deleteRemote(v.path);
            R.delete(v.path);
            result.deletedRemote++;
          }
        }

        // Cache the merged content as the new common ancestor.
        if (isMergeableText(g.base, winnerContent.byteLength)) {
          await this.mergeCache.set(g.base, new TextDecoder("utf-8").decode(winnerContent));
        }

        this.logger.ok(`⇄ Collapsed "${g.base}" (${g.versions.length} versions → 1).`);
      } catch (e) {
        this.logger.error(`Cleanup failed for "${g.base}".`, e);
        result.errors++;
      }
    }

    return result;
  }

  /** Sequential three-way merge across the sorted versions. The merge-cache
   *  ancestor (real last-synced content) seeds the common base when present.
   *  Returns undefined if any merge is unclean (caller falls back to newest). */
  private async mergeGroup(g: ConflictGroup, L: Map<string, FileEntry>, R: Map<string, RemoteFile>): Promise<ArrayBuffer | undefined> {
    const texts: string[] = [];
    for (const v of g.versions) {
      const buf = await this.readVersion(v.path, L, R);
      if (!buf) return undefined;
      texts.push(new TextDecoder("utf-8").decode(buf));
    }

    const ancestor = await this.mergeCache.get(g.base);
    let acc = texts[0];
    let prev = ancestor ?? texts[0];

    for (let i = 1; i < texts.length; i++) {
      const { merged, clean } = attemptTextMerge(acc, texts[i], prev);
      if (!clean) return undefined;
      acc = merged;
      prev = acc;
    }

    const enc = new TextEncoder().encode(acc);
    return enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
  }

  /** Read a version's bytes: prefer the local vault, fall back to MEGA. */
  private async readVersion(path: string, L: Map<string, FileEntry>, R: Map<string, RemoteFile>): Promise<ArrayBuffer | undefined> {
    try {
      if (L.has(path) && (await this.local.exists(path))) {
        return await this.local.read(path);
      }
      if (R.has(path)) {
        const buf = await this.mega.download(path);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      }
      return undefined;
    } catch (e) {
      this.logger.warn(`Cleanup: could not read "${path}": ${String(e)}`);
      return undefined;
    }
  }

  /** Rebuild the snapshot from the post-cleanup L and R maps (per-side state,
   *  same as SyncEngine.rebuildSnapshot). */
  rebuildSnapshot(snapshot: SyncSnapshot, L: Map<string, FileEntry>, R: Map<string, RemoteFile>): void {
    const files: Record<string, SnapshotEntry> = {};
    for (const [path, l] of L) {
      const r = R.get(path);
      files[path] = {
        path,
        size: r ? r.size : l.size,
        hash: l.hash,
        localMtime: l.mtime,
        remoteMtime: r ? r.mtime : 0,
      };
    }
    for (const [path, r] of R) {
      if (!files[path]) {
        files[path] = { path, size: r.size, hash: r.hash, localMtime: 0, remoteMtime: r.mtime };
      }
    }
    snapshot.files = files;
    snapshot.v = SNAPSHOT_VERSION;
    snapshot.savedAt = Date.now();
  }
}
