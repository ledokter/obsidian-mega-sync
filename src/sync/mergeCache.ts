// Caches the last-known-synced content of mergeable text files, so the next
// conflict on that file can run a real three-way merge against a genuine
// common ancestor instead of textMerge.ts's LCS-reconstructed approximation.
// The plugin's snapshot only ever stored {path, mtime, size} — never
// content — so without this cache there is nothing to diff a conflict
// against except a guess.
//
// Stored as plain files under the plugin's own data folder (never inside the
// vault's user-visible tree), mirroring each cached path — e.g.
// "<plugin-dir>/merge-cache/notes/todo.md". Populated lazily: only written
// when a file is actually uploaded, downloaded, or cleanly merged (never a
// bulk backfill, which would mean re-reading every note in the vault on the
// first sync after upgrading).
import { App } from "obsidian";

export class MergeCache {
  private app: App;
  private root: string;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.root = `${pluginDir}/merge-cache`;
  }

  private fullPath(relPath: string): string {
    return `${this.root}/${relPath}`;
  }

  /** Returns the cached content for `relPath`, or null if never cached (the
   *  caller should fall back to the LCS-reconstructed ancestor). */
  async get(relPath: string): Promise<string | null> {
    const p = this.fullPath(relPath);
    try {
      if (!(await this.app.vault.adapter.exists(p))) return null;
      return new TextDecoder("utf-8").decode(await this.app.vault.adapter.readBinary(p));
    } catch {
      return null;
    }
  }

  /** Record `content` as the last-known-synced state of `relPath`. Best
   *  effort — a failed cache write must never break the sync itself. */
  async set(relPath: string, content: string): Promise<void> {
    const p = this.fullPath(relPath);
    try {
      const parent = p.split("/").slice(0, -1).join("/");
      if (parent && !(await this.app.vault.adapter.exists(parent))) {
        await this.app.vault.adapter.mkdir(parent);
      }
      const bytes = new TextEncoder().encode(content);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await this.app.vault.adapter.writeBinary(p, ab);
    } catch {
      /* best-effort */
    }
  }

  /** Drop the cached ancestor for `relPath` (the file was deleted on at
   *  least one side — a future re-creation shouldn't merge against stale
   *  content from before the deletion). */
  async remove(relPath: string): Promise<void> {
    const p = this.fullPath(relPath);
    try {
      if (await this.app.vault.adapter.exists(p)) await this.app.vault.adapter.remove(p);
    } catch {
      /* best-effort */
    }
  }
}
