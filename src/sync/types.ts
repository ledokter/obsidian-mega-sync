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

/** Plugin settings persisted in data.json. */
export interface MegaSyncSettings {
  /** MEGA account email. */
  email: string;
  /** MEGA account password (stored locally, optionally encrypted at rest). */
  password: string;
  /** 2FA / second factor code (blank if not enabled). Recomputed each sync if needed. */
  secondFactorCode: string;
  /** Folder name on MEGA used as the sync root (created if missing). */
  baseFolder: string;
  /** Sub-folder inside the base folder (e.g. for multiple vaults). Blank = root. */
  remoteSubFolder: string;
  /** Master passphrase to lock the settings UI. Blank = no lock. */
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
  baseFolder: "Obsidian-MEGA-Sync",
  remoteSubFolder: "",
  settingsPassword: "",
  syncOnStartup: false,
  syncIntervalMinutes: 0,
  syncOnSave: false,
  syncOnSaveDebounceMs: 5000,
  syncOnlyIfOnline: true,
  syncVaultConfig: false,
  excludePatterns: [
    ".trash/**",
    ".obsidian/workspace.json",
    ".obsidian/workspace-mobile.json",
    ".obsidian/cache",
    ".obsidian/plugins/mega-sync/data.json",
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