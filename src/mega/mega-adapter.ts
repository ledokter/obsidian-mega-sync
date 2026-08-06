// MEGA.nz adapter built on top of the `megajs` library.
//
// Responsibilities:
//   - Authenticate (email + password, optional 2FA), caching the session.
//   - Resolve / create the remote base folder (+ optional sub-folder).
//   - List the remote tree into a flat map of vault-relative path -> RemoteFile.
//   - Upload, download, rename, delete, mkdir.
//   - Persist / read the sync snapshot on MEGA so multiple devices converge.
import { Storage, MutableFile, File } from "megajs";
import { Logger } from "../ui/logger";
import { joinPath, normalizePath } from "../util";
import { SyncSnapshot, FileEntry } from "../sync/types";

const SNAPSHOT_FILE = "_mega_sync_snapshot.json";

export interface RemoteFile {
  path: string;
  size: number;
  mtime: number; // ms
  node: MutableFile;
  isDir: boolean;
}

export interface MegaAdapterOpts {
  email: string;
  password: string;
  secondFactorCode?: string;
  baseFolder: string;
  remoteSubFolder?: string;
}

export class MegaAdapter {
  private storage: Storage | null = null;
  private baseNode: MutableFile | null = null;
  private logger: Logger;
  private opts: MegaAdapterOpts;

  constructor(logger: Logger, opts: MegaAdapterOpts) {
    this.logger = logger;
    this.opts = opts;
  }

  /** Open (or reuse) a MEGA session. */
  async connect(): Promise<void> {
    if (this.storage) return;
    const { email, password, secondFactorCode } = this.opts;
    if (!email || !password) {
      throw new Error("MEGA credentials are not configured.");
    }
    this.logger.info(`Connecting to MEGA as ${email}…`);
    const storage = new Storage({
      email,
      password,
      secondFactorCode: secondFactorCode || undefined,
      autoload: true,
      autologin: true,
      keepalive: false,
    });
    try {
      await storage.ready;
    } catch (e) {
      try {
        await storage.close();
      } catch {
        /* ignore */
      }
      throw e;
    }
    this.storage = storage;
    this.logger.ok("MEGA session established.");
  }

  /** Resolve (creating if needed) the base folder + optional sub-folder. */
  async resolveBase(): Promise<MutableFile> {
    if (!this.storage) throw new Error("Not connected.");
    if (this.baseNode) return this.baseNode;

    const root = this.storage.root as MutableFile;
    await this.ensureLoaded(root);

    let base = await this.findChild(root, this.opts.baseFolder);
    if (!base) {
      base = (await root.mkdir(this.opts.baseFolder)) as MutableFile;
      this.logger.info(`Created remote base folder "${this.opts.baseFolder}".`);
    }
    await this.ensureLoaded(base);

    const sub = (this.opts.remoteSubFolder || "").trim();
    if (sub) {
      let node = await this.findChild(base, sub);
      if (!node) {
        node = (await base.mkdir(sub)) as MutableFile;
        this.logger.info(`Created remote sub-folder "${sub}".`);
      }
      await this.ensureLoaded(node);
      this.baseNode = node;
    } else {
      this.baseNode = base;
    }
    return this.baseNode;
  }

  /** Make sure a folder node has its children loaded. */
  private async ensureLoaded(node: MutableFile): Promise<void> {
    if (node.children) return;
    await node.loadAttributes();
  }

  /** Case-insensitive name lookup among immediate children. */
  private async findChild(
    parent: MutableFile,
    name: string,
  ): Promise<MutableFile | null> {
    await this.ensureLoaded(parent);
    const children = parent.children ?? [];
    const lower = name.toLowerCase();
    for (const c of children) {
      if ((c.name ?? "").toLowerCase() === lower) return c as MutableFile;
    }
    return null;
  }

  /** Recursively list every file under the base folder. Returns flat map. */
  async listRemote(): Promise<Map<string, RemoteFile>> {
    const base = await this.resolveBase();
    const out = new Map<string, RemoteFile>();
    await this.walk(base, "", out);
    // Filter out our own snapshot file so it's not treated as user content.
    out.delete(SNAPSHOT_FILE);
    return out;
  }

  private async walk(
    node: MutableFile,
    relPath: string,
    out: Map<string, RemoteFile>,
  ): Promise<void> {
    await this.ensureLoaded(node);
    const children = node.children ?? [];
    for (const child of children) {
      const childPath = relPath ? joinPath(relPath, child.name ?? "") : (child.name ?? "");
      if (child.directory) {
        await this.walk(child as MutableFile, childPath, out);
      } else {
        out.set(normalizePath(childPath), {
          path: normalizePath(childPath),
          size: child.size ?? 0,
          mtime: (child.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
          node: child as MutableFile,
          isDir: false,
        });
      }
    }
  }

  /** Upload a buffer to `path` (relative to base). Overwrites nothing —
   *  if a file with the same name exists, it is deleted first. */
  async upload(relPath: string, data: Buffer, mtime?: number): Promise<RemoteFile> {
    const base = await this.resolveBase();
    const { folder, name } = await this.ensureFolder(base, relPath);
    const existing = await this.findChild(folder, name);
    if (existing) {
      await existing.delete(false).catch((e) => this.logger.warn(`Could not delete existing remote "${relPath}": ${String(e)}`));
    }
    const upload = folder.upload(
      { name, size: data.length, maxChunkSize: 1024 * 1024 },
      data,
    );
    const file = (await upload.complete) as MutableFile;
    return {
      path: normalizePath(relPath),
      size: file.size ?? data.length,
      mtime: (file.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
      node: file,
      isDir: false,
    };
  }

  /** Download a remote file to a Buffer. */
  async download(relPath: string): Promise<Buffer> {
    const base = await this.resolveBase();
    const { folder, name } = await this.ensureFolder(base, relPath);
    const file = await this.findChild(folder, name);
    if (!file) throw new Error(`Remote file not found: ${relPath}`);
    const buf = await file.downloadBuffer({});
    return buf;
  }

  /** Rename a remote file (used for conflict copies). */
  async rename(relPath: string, newName: string): Promise<void> {
    const base = await this.resolveBase();
    const { folder, name } = await this.ensureFolder(base, relPath);
    const file = await this.findChild(folder, name);
    if (!file) throw new Error(`Remote file not found for rename: ${relPath}`);
    await file.rename(newName);
  }

  /** Delete a remote file (or empty folder). */
  async deleteRemote(relPath: string): Promise<void> {
    const base = await this.resolveBase();
    const { folder, name } = await this.ensureFolder(base, relPath);
    const file = await this.findChild(folder, name);
    if (file) await file.delete(false);
  }

  /** Read the persisted snapshot from MEGA, if present. */
  async readSnapshot(): Promise<SyncSnapshot | null> {
    try {
      const base = await this.resolveBase();
      const file = await this.findChild(base, SNAPSHOT_FILE);
      if (!file) return null;
      const buf = await file.downloadBuffer({});
      const json = JSON.parse(buf.toString("utf8"));
      return json as SyncSnapshot;
    } catch (e) {
      this.logger.warn(`Could not read remote snapshot: ${String(e)}`);
      return null;
    }
  }

  /** Write the snapshot to MEGA. */
  async writeSnapshot(snapshot: SyncSnapshot): Promise<void> {
    const data = Buffer.from(JSON.stringify(snapshot), "utf8");
    await this.upload(SNAPSHOT_FILE, data);
  }

  /** Ensure the parent folder chain for `relPath` exists; return the parent
   *  folder node and the final file name. */
  private async ensureFolder(
    base: MutableFile,
    relPath: string,
  ): Promise<{ folder: MutableFile; name: string }> {
    const parts = normalizePath(relPath).split("/").filter(Boolean);
    if (parts.length === 0) throw new Error("Empty path.");
    const name = parts[parts.length - 1];
    let cur = base;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = await this.findChild(cur, seg);
      if (!next) {
        next = (await cur.mkdir(seg)) as MutableFile;
      }
      await this.ensureLoaded(next);
      cur = next;
    }
    return { folder: cur, name };
  }

  /** Close the session. */
  async close(): Promise<void> {
    if (this.storage) {
      try {
        await this.storage.close();
      } catch {
        /* ignore */
      }
      this.storage = null;
      this.baseNode = null;
    }
  }
}

/** Convert a remote file entry to the normalized FileEntry used by the engine. */
export function remoteToEntry(r: RemoteFile): FileEntry {
  return { path: r.path, mtime: r.mtime, size: r.size };
}