// Shared type definitions for MEGA Sync.

/** A normalized representation of a file in the local vault or on the remote. */
export interface FileEntry {
  /** Vault-relative POSIX path (forward slashes), no leading slash. */
  path: string;
  /** Last modified time in milliseconds since epoch. */
  mtime: number;
  /** Size in bytes. */
  size: number;
}

/**
 * The persisted snapshot of the last successful sync.
 * Maps vault-relative path -> the state as it was right after the last sync.
 * Stored locally (in plugin data) and mirrored on MEGA as
 * `_mega_sync_snapshot.json` inside the base folder, so multiple devices
 * can converge.
 */
export interface SyncSnapshot {
  /** Schema version of the snapshot format. */
  v: number;
  /** Epoch milliseconds when the snapshot was written. */
  savedAt: number;
  /** Map of path -> entry as it was at last sync. */
  files: Record<string, FileEntry>;
}

/** Operations the sync engine decides to perform. */
export type OpType =
  | "upload"
  | "download"
  | "deleteRemote"
  | "deleteLocal"
  | "mkdirRemote"
  | "conflict"
  | "skip";

export interface SyncOp {
  type: OpType;
  path: string;
  reason: string;
}

/** Lightweight representation of a cached MEGA session (no password). */
export interface SessionCache {
  /** e64-encoded master key (from megajs `toJSON().key`). */
  key: string;
  /** Session id string. */
  sid: string;
  name?: string;
  user?: string;
}

/** The decrypted MEGA secrets held in memory only. */
export interface Secrets {
  email: string;
  password: string;
  secondFactorCode: string;
  session: SessionCache | null;
}

/** Encrypted container persisted at rest. */
export interface EncryptedBlob {
  /** Base64 ciphertext. */
  cipher: string;
  /** Base64 12-byte IV. */
  iv: string;
  /** Base64 16-byte salt. */
  salt: string;
  /** Base64 GCM auth tag. */
  tag: string;
}

/** Plugin settings persisted in data.json. */
export interface MegaSyncSettings {
  /** MEGA account email (plaintext, only when encryption is disabled). */
  email: string;
  /** MEGA account password (plaintext, only when encryption is disabled). */
  password: string;
  /** 2FA / second factor code (plaintext, only when encryption is disabled). */
  secondFactorCode: string;
  /** Cached MEGA session (plaintext, only when encryption is disabled). */
  session: SessionCache | null;
  /** Folder name on MEGA used as the sync root (created if missing). */
  baseFolder: string;
  /** Sub-folder inside the base folder (e.g. for multiple vaults). Blank = root. */
  remoteSubFolder: string;

  /** Whether secrets are encrypted at rest with a master passphrase. */
  secretsEncrypted: boolean;
  /** The encrypted secrets blob (when `secretsEncrypted` is true). */
  secretsBlob: EncryptedBlob | null;
  /** Legacy settings lock password (migrated to encryption on first load). */
  settingsPassword: string;

  /** Sync automatically on Obsidian startup. */
  syncOnStartup: boolean;
  /** Auto-sync interval in minutes. 0 = disabled. */
  syncIntervalMinutes: number;
  /** Debounced sync after local vault changes. 0 = disabled. */
  syncOnSave: boolean;
  /** Debounce window (ms) for sync-on-save. */
  syncOnSaveDebounceMs: number;
  /** Only sync when Obsidian reports it is online. */
  syncOnlyIfOnline: boolean;

  /** Include the `.obsidian` folder (vault config) in sync. */
  syncVaultConfig: boolean;
  /** Glob / regex patterns of paths to exclude (one per line). */
  excludePatterns: string;
  /** Glob / regex patterns to force-include even if excluded (one per line). */
  includePatterns: string;
  /** Skip files larger than this many MB. 0 = no limit. */
  maxFileMb: number;
  /** Skip binary file detection (always sync bytes). */
  syncHiddenFiles: boolean;

  /** Show a status bar item. */
  showStatusBar: boolean;
  /** Show a ribbon icon. */
  showRibbon: boolean;
  /** Keep a local log file under the plugin folder. */
  keepLogFile: boolean;
  /** Number of log lines to keep in the ring buffer. */
  logLines: number;
  /** Quarantine folder name for conflict copies (local). */
  conflictFolder: string;
  /** Don't actually delete, move to quarantine instead. */
  useTrashForDeletion: boolean;
  /** Confirm before deleting local files. */
  confirmLocalDeletion: boolean;

  /** Last snapshot kept locally for resync. */
  lastSnapshot?: SyncSnapshot;
}

export const DEFAULT_SETTINGS: MegaSyncSettings = {
  email: "",
  password: "",
  secondFactorCode: "",
  session: null,
  baseFolder: "Obsidian-MEGA-Sync",
  remoteSubFolder: "",
  secretsEncrypted: false,
  secretsBlob: null,
  settingsPassword: "",
  syncOnStartup: false,
  syncIntervalMinutes: 0,
  syncOnSave: false,
  syncOnSaveDebounceMs: 5000,
  syncOnlyIfOnline: true,
  syncVaultConfig: false,
  excludePatterns: [
    ".trash/**",
    "node_modules/**",
    ".git/**",
  ].join("\n"),
  includePatterns: "",
  maxFileMb: 0,
  syncHiddenFiles: true,
  showStatusBar: true,
  showRibbon: true,
  keepLogFile: true,
  logLines: 500,
  conflictFolder: ".mega-sync-conflicts",
  useTrashForDeletion: true,
  confirmLocalDeletion: true,
};

/** Result of a sync run, surfaced to the UI. */
export interface SyncResult {
  uploaded: number;
  downloaded: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: number;
  skipped: number;
  errors: number;
  durationMs: number;
}