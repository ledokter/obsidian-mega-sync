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

  /** Sync direction. `two-way` mirrors both sides; `upload-only` makes the
   *  remote an exact copy of the local; `download-only` makes the local an
   *  exact copy of the remote. One-way modes are strict mirrors: deletions
   *  on the source side propagate to the target, and conflicts resolve in
   *  favour of the source (overwriting the target). */
  syncDirection: "two-way" | "upload-only" | "download-only" | "push-only" | "pull-only";
  /** Show a Notice announcing each sync (manual and automatic) before it starts. */
  notifyBeforeSync: boolean;
  /** Show a confirmation modal before MANUAL syncs only. Automatic syncs
   *  (startup / interval / debounced) are never blocked. */
  confirmManualSync: boolean;

  /** Include the `.obsidian` folder (vault config) in sync. */
  syncVaultConfig: boolean;
  /** Sync only `.obsidian/bookmarks.json` without the rest of the config folder.
   *  Only effective when `syncVaultConfig` is false. */
  syncBookmarks: boolean;
  /** Glob / regex patterns of paths to exclude (one per line). */
  excludePatterns: string;
  /** Glob / regex patterns to force-include even if excluded (one per line). */
  includePatterns: string;
  /** JavaScript regular expressions (one per line) of paths to ignore. Applied
   *  to both local and remote, in addition to the glob exclude patterns. */
  ignorePathsRegex: string;
  /** JavaScript regular expressions (one per line) allowlist. When non-empty,
   *  only paths matching at least one regex are synced. Empty = allow all. */
  onlyAllowPathsRegex: string;
  /** Skip files larger than this many MB. 0 = no limit. */
  maxFileMb: number;
  /** Include dotfiles and files inside hidden folders. Dot-prefixed paths are
   *  skipped by default (like Remotely Save); enable to sync them. */
  syncHiddenFiles: boolean;
  /** Include files/folders starting with `_` (underscore). Skipped by default. */
  syncUnderscoreItems: boolean;
  /** Abort the sync if more than this % of all files would be modified or
   *  deleted in a single run. 0 = always block, 100 = disabled. Safety guard
   *  against mass deletions (e.g. a wrongly-empty vault). */
  protectModifyPercentage: number;

  /** File-type filter mode. `all` syncs every type; `whitelist` syncs only
   *  the extensions selected via the presets + custom list below. Excluded
   *  files are left untouched on both sides (non-destructive). */
  fileTypeMode: "all" | "whitelist";
  /** Whitelist preset: notes (md, txt, canvas). */
  fileTypePresetNotes: boolean;
  /** Whitelist preset: images (png, jpg, jpeg, gif, svg, webp). */
  fileTypePresetImages: boolean;
  /** Whitelist preset: PDF. */
  fileTypePresetPdf: boolean;
  /** Whitelist preset: audio (mp3, wav, ogg, m4a, flac). */
  fileTypePresetAudio: boolean;
  /** Whitelist preset: video (mp4, mov, webm, mkv). */
  fileTypePresetVideo: boolean;
  /** Extra extensions (comma/space separated, no dot) to sync in addition to
   *  the selected presets when `fileTypeMode === "whitelist"`. */
  fileTypeCustomExt: string;

  /** Show a status bar item. */
  showStatusBar: boolean;
  /** Show a ribbon icon. */
  showRibbon: boolean;
  /** Master switch for the sync log. When false, nothing is recorded in the
   *  in-memory ring buffer or the on-disk log file (and the "Show sync log"
   *  modal will be empty). */
  enableLogging: boolean;
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
  syncDirection: "two-way",
  notifyBeforeSync: true,
  confirmManualSync: false,
  syncVaultConfig: false,
  syncBookmarks: false,
  excludePatterns: [
    ".trash/**",
    "node_modules/**",
    ".git/**",
  ].join("\n"),
  includePatterns: "",
  ignorePathsRegex: "",
  onlyAllowPathsRegex: "",
  maxFileMb: 0,
  syncHiddenFiles: true,
  syncUnderscoreItems: false,
  protectModifyPercentage: 50,
  fileTypeMode: "all",
  fileTypePresetNotes: false,
  fileTypePresetImages: false,
  fileTypePresetPdf: false,
  fileTypePresetAudio: false,
  fileTypePresetVideo: false,
  fileTypeCustomExt: "",
  showStatusBar: true,
  showRibbon: true,
  enableLogging: true,
  keepLogFile: true,
  logLines: 500,
  conflictFolder: ".mega-sync-conflicts",
  useTrashForDeletion: true,
  confirmLocalDeletion: true,
};

/** Whitelist presets for the file-type filter. The keys match the boolean
 *  settings fields `fileTypePreset<key>`. Used by both the settings UI (for
 *  labels/descriptions) and the sync engine (to resolve selected presets to
 *  allowed extensions). */
export const FILE_TYPE_PRESETS: Record<string, { label: string; exts: string[] }> = {
  notes: { label: "Notes", exts: ["md", "txt", "canvas"] },
  images: { label: "Images", exts: ["png", "jpg", "jpeg", "gif", "svg", "webp"] },
  pdf: { label: "PDF", exts: ["pdf"] },
  audio: { label: "Audio", exts: ["mp3", "wav", "ogg", "m4a", "flac"] },
  video: { label: "Video", exts: ["mp4", "mov", "webm", "mkv"] },
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