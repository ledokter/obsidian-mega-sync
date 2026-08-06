// Local vault inventory: walk the vault, apply include/exclude rules, and
// produce a flat map of vault-relative path -> FileEntry (mtime, size).
import { App, TFile, TFolder, TAbstractFile, Vault } from "obsidian";
import { MegaSyncSettings, FileEntry } from "./types";
import { matchesAnyPattern, normalizePath } from "../util";

/** Patterns always excluded, regardless of settings (plugin internals). */
const ALWAYS_EXCLUDED = [
  ".mega-sync-conflicts/**",
  ".mega-sync-log/**",
  // The plugin's own data file must never be synced.
  ".obsidian/plugins/mega-sync/data.json",
];

export class LocalInventory {
  constructor(private app: App, private settings: MegaSyncSettings) {}

  /** Build the local inventory map. */
  async build(): Promise<Map<string, FileEntry>> {
    const out = new Map<string, FileEntry>();
    const root = this.app.vault.getRoot();
    await this.walk(root, out);
    return out;
  }

  private async walk(folder: TFolder, out: Map<string, FileEntry>): Promise<void> {
    const children: TAbstractFile[] = folder.children ?? [];
    for (const child of children) {
      const rel = normalizePath(child.path);
      if (child instanceof TFile) {
        if (this.isExcluded(rel)) continue;
        if (this.tooLarge(child.stat.size)) continue;
        out.set(rel, {
          path: rel,
          mtime: child.stat.mtime,
          size: child.stat.size,
        });
      } else if (child instanceof TFolder) {
        // Skip the .obsidian folder entirely unless configured to include it.
        if (rel === ".obsidian" && !this.settings.syncVaultConfig) continue;
        if (this.isExcluded(rel)) continue;
        await this.walk(child, out);
      }
    }
  }

  private isExcluded(path: string): boolean {
    if (ALWAYS_EXCLUDED.some((p) => this.match(p, path))) return true;
    if (matchesAnyPattern(this.settings.excludePatterns, path)) {
      // Allow an explicit include pattern to override.
      if (this.settings.includePatterns.trim().length > 0 &&
          matchesAnyPattern(this.settings.includePatterns, path)) {
        return false;
      }
      return true;
    }
    return false;
  }

  private match(pattern: string, path: string): boolean {
    // Reuse the same glob matcher via matchesAnyPattern with a single line.
    return matchesAnyPattern(pattern, path);
  }

  private tooLarge(size: number): boolean {
    const max = this.settings.maxFileMb;
    if (!max || max <= 0) return false;
    return size > max * 1024 * 1024;
  }

  /** Read the raw bytes of a local file. */
  async read(path: string): Promise<ArrayBuffer> {
    return this.app.vault.adapter.readBinary(path);
  }

  /** Write bytes to a local file, creating folders as needed. */
  async write(path: string, data: ArrayBuffer, mtime?: number): Promise<void> {
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent && !(await this.app.vault.adapter.exists(parent))) {
      await this.app.vault.adapter.mkdir(parent);
    }
    await this.app.vault.adapter.writeBinary(path, data);
    // Obsidian doesn't expose a portable mtime setter; we rely on the
    // snapshot to track the canonical mtime across devices.
    void mtime;
  }

  /** Delete a local file, optionally via the trash. */
  async delete(path: string, toTrash: boolean): Promise<void> {
    if (toTrash) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.app.vault.trash(file, true);
        return;
      }
    }
    if (await this.app.vault.adapter.exists(path)) {
      await this.app.vault.adapter.remove(path);
    }
  }

  /** Rename a local file (for conflict copies). */
  async renameLocal(path: string, newPath: string): Promise<void> {
    const parent = newPath.split("/").slice(0, -1).join("/");
    if (parent && !(await this.app.vault.adapter.exists(parent))) {
      await this.app.vault.adapter.mkdir(parent);
    }
    await this.app.vault.adapter.rename(path, newPath);
  }

  exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }
}

export function localVault(app: App): Vault {
  return app.vault;
}