// Settings — declarative API (Obsidian 1.13.0+).
//
// Uses getSettingDefinitions() so the settings are rendered declaratively
// and indexed for settings search. Simple values are bound to plugin.settings
// (or plugin.secrets for credentials) via getControlValue/setControlValue.
// The password field and the button rows use render/action definitions
// because they need masked inputs / modals not expressible as plain controls.
import { App, PluginSettingTab, Setting, Modal, Notice, SettingDefinitionItem } from "obsidian";
import { MegaSyncPlugin } from "./main";
import { DEFAULT_SETTINGS, FILE_TYPE_PRESETS } from "./sync/types";
import { formatDuration } from "./util";

const CRED_KEYS = ["email", "secondFactorCode"] as const;
type CredKey = (typeof CRED_KEYS)[number];

export class MegaSyncSettingTab extends PluginSettingTab {
  plugin: MegaSyncPlugin;

  constructor(app: App, plugin: MegaSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ----- value binding -----------------------------------------------------

  getControlValue(key: string): unknown {
    if (CRED_KEYS.includes(key as CredKey)) return this.getCred(key as CredKey);
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (CRED_KEYS.includes(key as CredKey)) {
      await this.setCred(key as CredKey, typeof value === "string" ? value : "");
      return;
    }
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
    this.plugin.applyUiVisibility();
    if (key === "syncIntervalMinutes") this.plugin.scheduleInterval();
  }

  private getCred(key: CredKey): string {
    const s = this.plugin.secrets;
    if (!s) return "";
    if (key === "email") return s.email;
    return s.secondFactorCode;
  }

  private async setCred(key: CredKey, value: string): Promise<void> {
    const s = this.plugin.secrets;
    if (!s) return;
    if (key === "email") s.email = value;
    else s.secondFactorCode = value;
    await this.plugin.persistSecrets();
  }

  // ----- definitions -------------------------------------------------------

  getSettingDefinitions(): SettingDefinitionItem[] {
    const locked = this.plugin.isLocked();
    const encrypted = this.plugin.settings.secretsEncrypted;
    const s = this.plugin.settings;

    return [
      // Unlock affordance shown only when the secrets are encrypted & locked.
      {
        name: "Locked",
        desc: "Enter your master passphrase to unlock the MEGA credentials.",
        aliases: ["passphrase", "unlock", "encrypt"],
        visible: () => this.plugin.isLocked(),
        action: () => { void (async () => {
          const pass = await this.askPassphrase("Unlock", "Master passphrase");
          if (pass === null) return;
          try {
            await this.plugin.unlock(pass);
            this.update();
          } catch (e) {
            new Notice(e instanceof Error ? e.message : "Wrong passphrase.");
          }
        })(); },
      },

      // Security
      {
        type: "group",
        heading: "Security",
        items: [
          encrypted
            ? {
                name: "Secrets encrypted",
                desc: "Your MEGA email, password, 2FA code and cached session are encrypted at rest with AES-256-GCM. The passphrase is only kept in memory for this session.",
                action: () => {
                  this.plugin.lockNow();
                  this.update();
                  new Notice("MEGA Sync locked.");
                },
              }
            : {
                name: "Master passphrase",
                desc: "Set a passphrase to encrypt your MEGA credentials and cached session at rest. It will also lock this settings panel. Without it, secrets are stored in plaintext in data.json.",
                action: () => { void (async () => {
                  const pass = await this.askPassphrase("Set master passphrase", "Choose a passphrase", true);
                  if (pass === null) return;
                  try {
                    await this.plugin.setMasterPassphrase(pass);
                    this.update();
                    new Notice("Secrets encrypted at rest.");
                  } catch (e) {
                    new Notice(e instanceof Error ? e.message : "Failed.");
                  }
                })(); },
              },
          encrypted
            ? {
                name: "Disable encryption",
                desc: "Decrypt and store secrets in plaintext again. Requires the current passphrase.",
                action: () => { void (async () => {
                  const pass = await this.askPassphrase("Disable encryption", "Enter current master passphrase");
                  if (pass === null) return;
                  try {
                    await this.plugin.disableEncryption(pass);
                    this.update();
                    new Notice("Encryption disabled.");
                  } catch (e) {
                    new Notice(e instanceof Error ? e.message : "Failed.");
                  }
                })(); },
              }
            : {
                name: "Plaintext warning",
                desc: "Until you enable encryption, your MEGA password is stored in clear text inside this vault. Do not commit the config folder to a public repository.",
                searchable: false,
                action: () => {},
              },
        ],
      },

      // MEGA account
      {
        type: "group",
        heading: "MEGA account",
        items: [
          {
            name: "Email",
            desc: "Your MEGA account email.",
            aliases: ["account", "login"],
            visible: () => !locked,
            control: { type: "text", key: "email", placeholder: "you@example.com" },
          },
          {
            name: "Password",
            desc: "Your MEGA account password. Stored encrypted at rest if a master passphrase is set.",
            aliases: ["secret"],
            visible: () => !locked,
            render: (setting: Setting) => {
              setting.addText((t) => {
                t.inputEl.type = "password";
                t.setValue(this.plugin.secrets?.password ?? "");
                t.onChange(async (v) => {
                  if (this.plugin.secrets) {
                    this.plugin.secrets.password = v;
                    await this.plugin.persistSecrets();
                  }
                });
              });
            },
          },
          {
            name: "2FA code",
            desc: "If you have two-factor authentication on MEGA, enter the current code. Needed only at login time; blank otherwise.",
            aliases: ["mfa", "totp", "second factor"],
            visible: () => !locked,
            control: { type: "text", key: "secondFactorCode", placeholder: "123456" },
          },
          {
            name: "Test read/write",
            desc: "Connect to MEGA, write a small test file, read it back, verify it, then delete it. Validates the full upload/download/delete path.",
            visible: () => !locked,
            action: () => { void this.plugin.testConnection(); },
          },
        ],
      },

      // Remote folder
      {
        type: "group",
        heading: "Remote folder",
        items: [
          {
            name: "Base folder",
            desc: "Folder created at the root of your MEGA drive used as the sync container.",
            control: { type: "text", key: "baseFolder" },
          },
          {
            name: "Remote sub-folder",
            desc: "Optional sub-folder inside the base folder. Useful to sync multiple vaults to the same MEGA folder with different names.",
            control: { type: "text", key: "remoteSubFolder" },
          },
        ],
      },

      // Sync triggers
      {
        type: "group",
        heading: "Sync triggers",
        items: [
          {
            name: "Sync direction",
            desc: "Two-way mirrors both sides. Upload-only / Download-only are strict mirrors: source-side deletions propagate to the target and conflicts overwrite the target (can delete files). Push-only / Pull-only are safer one-way modes: they only transfer new and modified files and never delete anything on either side.",
            control: {
              type: "dropdown",
              key: "syncDirection",
              options: {
                "two-way": "Two-way (mirror both sides)",
                "upload-only": "Upload only (local → MEGA, mirror)",
                "download-only": "Download only (MEGA → local, mirror)",
                "push-only": "Push only (local → MEGA, no deletions)",
                "pull-only": "Pull only (MEGA → local, no deletions)",
              },
            },
          },
          { name: "Auto bootstrap empty vault", desc: "On a device with an empty vault, the first sync downloads everything from MEGA (one-way), then automatically switches back to two-way sync. Runs only once per vault.", control: { type: "toggle", key: "autoBootstrapEmptyVault" } },
          { name: "Notify before sync", desc: "Show a brief on-screen notice when a sync (manual or automatic) starts.", control: { type: "toggle", key: "notifyBeforeSync" } },
          { name: "Confirm before manual sync", desc: "Show a confirmation modal before MANUAL syncs only. Automatic syncs (startup / interval / debounced) are never blocked.", control: { type: "toggle", key: "confirmManualSync" } },
          { name: "Sync on startup", desc: "Start a sync automatically when Obsidian opens. Requires unlocking the master passphrase (or no encryption).", control: { type: "toggle", key: "syncOnStartup" } },
          { name: "Auto-sync interval", desc: "Sync every N minutes while Obsidian is open. 0 disables.", control: { type: "number", key: "syncIntervalMinutes" } },
          { name: "Sync after changes", desc: "Start a debounced sync shortly after the vault changes.", control: { type: "toggle", key: "syncOnSave" } },
          { name: "Debounce (ms)", desc: "Wait this long after the last change before syncing.", control: { type: "number", key: "syncOnSaveDebounceMs" } },
          { name: "Only when online", desc: "Skip automatic syncs when Obsidian reports it is offline.", control: { type: "toggle", key: "syncOnlyIfOnline" } },
        ],
      },

      // What to sync
      {
        type: "group",
        heading: "What to sync",
        items: [
          {
            name: "File types",
            desc: "Sync all file types, or only the extensions selected below. Excluded files are left untouched on both sides (not deleted).",
            control: {
              type: "dropdown",
              key: "fileTypeMode",
              options: {
                "all": "All file types",
                "whitelist": "Only selected types",
              },
            },
          },
          { name: "Notes", desc: `Sync notes: ${FILE_TYPE_PRESETS.notes.exts.join(", ")}.`, visible: () => s.fileTypeMode === "whitelist", control: { type: "toggle", key: "fileTypePresetNotes" } },
          { name: "Images", desc: `Sync images: ${FILE_TYPE_PRESETS.images.exts.join(", ")}.`, visible: () => s.fileTypeMode === "whitelist", control: { type: "toggle", key: "fileTypePresetImages" } },
          { name: "PDF", desc: `Sync PDF: ${FILE_TYPE_PRESETS.pdf.exts.join(", ")}.`, visible: () => s.fileTypeMode === "whitelist", control: { type: "toggle", key: "fileTypePresetPdf" } },
          { name: "Audio", desc: `Sync audio: ${FILE_TYPE_PRESETS.audio.exts.join(", ")}.`, visible: () => s.fileTypeMode === "whitelist", control: { type: "toggle", key: "fileTypePresetAudio" } },
          { name: "Video", desc: `Sync video: ${FILE_TYPE_PRESETS.video.exts.join(", ")}.`, visible: () => s.fileTypeMode === "whitelist", control: { type: "toggle", key: "fileTypePresetVideo" } },
          { name: "Custom extensions", desc: "Extra extensions (comma or space separated, no dot) to sync in addition to the presets above. e.g. docx, xlsx, epub", visible: () => s.fileTypeMode === "whitelist", control: { type: "text", key: "fileTypeCustomExt", placeholder: "docx, xlsx, epub" } },
          { name: "Sync vault config", desc: "Include the config folder so settings, themes and plugins are mirrored across devices.", control: { type: "toggle", key: "syncVaultConfig" } },
          { name: "Sync bookmarks only", desc: "Sync only .obsidian/bookmarks.json without the rest of the config folder. Only effective when 'Sync vault config' is off.", visible: () => !s.syncVaultConfig, control: { type: "toggle", key: "syncBookmarks" } },
          { name: "Exclude patterns", desc: "Glob patterns (one per line) of paths to exclude. Supports * and **. e.g. .trash/** or *.tmp", control: { type: "textarea", key: "excludePatterns" } },
          { name: "Include patterns (override)", desc: "Paths matching these patterns are synced even if excluded above.", control: { type: "textarea", key: "includePatterns" } },
          { name: "Ignore paths (regex)", desc: "JavaScript regular expressions (one per line). Paths matching any regex are skipped on both sides, in addition to the glob patterns above. e.g. ^trash/ or \\.(tmp|bak)$", control: { type: "textarea", key: "ignorePathsRegex" } },
          { name: "Only allow paths (regex)", desc: "JavaScript regular expressions (one per line). When non-empty, only paths matching at least one regex are synced. Empty = allow all. Parents of allowed files are auto-allowed.", control: { type: "textarea", key: "onlyAllowPathsRegex" } },
          { name: "Max file size (MB)", desc: "Skip files larger than this. 0 = no limit.", control: { type: "number", key: "maxFileMb" } },
          { name: "Sync hidden files", desc: "Include dotfiles and files inside dot-prefixed folders. Off by default (dotfiles are skipped).", control: { type: "toggle", key: "syncHiddenFiles" } },
          { name: "Sync underscore items", desc: "Include files and folders starting with _ (underscore). Off by default.", control: { type: "toggle", key: "syncUnderscoreItems" } },
        ],
      },

      // Conflicts & deletion
      {
        type: "group",
        heading: "Conflicts & deletion",
        items: [
          { name: "Conflict folder", desc: "Name of the local folder where conflict copies are stored.", control: { type: "text", key: "conflictFolder" } },
          { name: "Use trash for deletion", desc: "Move deleted local files to the system trash instead of deleting permanently.", control: { type: "toggle", key: "useTrashForDeletion" } },
          { name: "Max % of files changed per sync", desc: "Abort the sync if more than this % of all files would be modified or deleted in a single run. Safety guard against mass deletions (e.g. a wrongly-empty vault). 0 = always block, 100 = disabled.", control: { type: "number", key: "protectModifyPercentage" } },
          { name: "Per-file timeout (minutes)", desc: "Give up on a single upload/download after this long and move on, instead of hanging forever (e.g. a stalled connection or an exhausted MEGA transfer quota). Doesn't cancel the stuck request, just stops waiting on it — use \"Stop sync\" (log window) to end the whole run.", control: { type: "number", key: "opTimeoutMinutes" } },
        ],
      },

      // Interface
      {
        type: "group",
        heading: "Interface",
        items: [
          { name: "Status bar", desc: "Show a sync status item in the status bar.", control: { type: "toggle", key: "showStatusBar" } },
          { name: "Ribbon icon", desc: "Show a sync button in the left ribbon.", control: { type: "toggle", key: "showRibbon" } },
          { name: "Enable sync log", desc: "Record sync activity in the in-memory log (and on disk if enabled below). When off, the log is empty and nothing is written to disk.", control: { type: "toggle", key: "enableLogging" } },
          { name: "Keep log file", desc: "Also persist the log to the plugin data folder.", control: { type: "toggle", key: "keepLogFile" } },
          { name: "Log lines", desc: "How many log lines to keep in memory.", control: { type: "number", key: "logLines" } },
        ],
      },

      // Maintenance
      {
        type: "group",
        heading: "Maintenance",
        items: [
          {
            name: "Show sync log",
            desc: "Open the recent sync log.",
            action: () => this.plugin.openLogModal(),
          },
          {
            name: "Reset local snapshot",
            desc: "Forget the locally cached sync snapshot. The remote snapshot (if any) is still used, so a first sync after this is treated as a merge, not a fresh sync.",
            action: () => { void (async () => {
              this.plugin.settings.lastSnapshot = undefined;
              await this.plugin.saveSettings();
              new Notice("Local snapshot reset.");
            })(); },
          },
          {
            name: "Lock secrets now",
            desc: "Drop the in-memory MEGA credentials. They stay encrypted at rest.",
            visible: () => this.plugin.settings.secretsEncrypted && !this.plugin.isLocked(),
            action: () => {
              this.plugin.lockNow();
              this.update();
              new Notice("MEGA Sync secrets locked.");
            },
          },
          {
            name: "Reset all settings",
            desc: "Restore the default configuration. Does NOT delete your files or your encrypted secrets blob.",
            action: () => { void (async () => {
              const blob = this.plugin.settings.secretsBlob;
              const enc = this.plugin.settings.secretsEncrypted;
              this.plugin.settings = { ...DEFAULT_SETTINGS };
              this.plugin.settings.secretsBlob = blob;
              this.plugin.settings.secretsEncrypted = enc;
              if (!enc) {
                this.plugin.secrets = { email: "", password: "", secondFactorCode: "", session: null };
              }
              await this.plugin.saveSettings();
              this.update();
              new Notice("Settings reset to defaults.");
            })(); },
          },
        ],
      },
    ];
  }

  // ----- helpers -----------------------------------------------------------

  /** Prompt modal returning the typed passphrase (or null on cancel). */
  private askPassphrase(title: string, label: string, withConfirm = false): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(title);
      const row1 = modal.contentEl.createDiv();
      row1.createEl("label", { text: label });
      const i1 = row1.createEl("input", { type: "password" });
      i1.addClass("mega-input-full");
      i1.addClass("mega-mt-6");
      let i2: HTMLInputElement | null = null;
      if (withConfirm) {
        const row2 = modal.contentEl.createDiv({ cls: "mega-mt-10" });
        row2.createEl("label", { text: "Confirm passphrase" });
        i2 = row2.createEl("input", { type: "password" });
        i2.addClass("mega-input-full");
        i2.addClass("mega-mt-6");
      }
      const btnRow = modal.contentEl.createDiv({ cls: "mega-mt-14 mega-text-right" });
      const cancel = btnRow.createEl("button", { text: "Cancel" });
      const ok = btnRow.createEl("button", { text: "OK" });
      ok.classList.add("mod-cta");
      const submit = () => {
        const v = i1.value;
        if (!v) { new Notice("Passphrase cannot be empty."); return; }
        if (i2 && i2.value !== v) { new Notice("Passphrases do not match."); return; }
        i1.value = ""; if (i2) i2.value = "";
        modal.close(); resolve(v);
      };
      ok.onclick = submit;
      i1.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      cancel.onclick = () => { modal.close(); resolve(null); };
      modal.onClose = () => resolve(null);
      modal.open();
    });
  }
}

/** Modal showing the recent sync log lines, with a copy button, a live
 *  progress readout, and a stop button while a sync is running. */
export class LogModal extends Modal {
  plugin: MegaSyncPlugin;
  private logBox!: HTMLElement;
  private progressRow!: HTMLElement;
  private progressText!: HTMLElement;
  private progressFill!: HTMLElement;
  private stopBtn!: HTMLButtonElement;
  private refreshTimer?: number;
  private lastLineCount = -1;

  constructor(app: App, plugin: MegaSyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("MEGA Sync — log");
    this.modalEl.addClass("mega-sync-log-modal");

    const toolbar = contentEl.createDiv({ cls: "mega-sync-log-toolbar" });
    const copyBtn = toolbar.createEl("button", { text: "Copy log" });
    copyBtn.onclick = () => this.copyLog();
    this.stopBtn = toolbar.createEl("button", { text: "Stop sync", cls: "mod-warning" });
    this.stopBtn.onclick = () => this.plugin.stopSync();

    this.progressRow = contentEl.createDiv({ cls: "mega-sync-progress-row" });
    this.progressText = this.progressRow.createDiv({ cls: "mega-sync-progress-text" });
    const track = this.progressRow.createDiv({ cls: "mega-sync-progress" });
    this.progressFill = track.createEl("span");

    this.logBox = contentEl.createDiv({ cls: "mega-sync-log" });

    this.render(true);
    this.refreshTimer = window.setInterval(() => this.render(false), 1000);
  }

  private copyLog(): void {
    const lines = this.plugin.logger.getLines();
    const text = lines.map((l) => `[${l.stamp}] ${l.level.toUpperCase()} ${l.text}`).join("\n");
    void navigator.clipboard
      .writeText(text)
      .then(() => new Notice(`Copied ${lines.length} log line(s) to the clipboard.`, 3000))
      .catch(() => new Notice("Could not copy the log — clipboard access denied.", 4000));
  }

  private render(force: boolean): void {
    // Progress row: only visible while a sync is running.
    const syncing = this.plugin.syncing;
    this.progressRow.toggleClass("mega-hidden", !syncing);
    this.stopBtn.toggleClass("mega-hidden", !syncing);
    if (syncing) {
      const p = this.plugin.lastProgress;
      const done = p?.done ?? 0;
      const total = p?.total ?? 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      this.progressFill.style.width = `${pct}%`;
      const eta = p && isFinite(p.etaMs) ? `~${formatDuration(p.etaMs)} left` : "estimating…";
      this.progressText.setText(p ? `${pct}% (${done}/${total}) — ${eta}` : "starting…");
    }

    // Log lines: only re-render when the line count changed (or forced),
    // and only auto-scroll if the user was already at (or near) the bottom.
    const lines = this.plugin.logger.getLines();
    if (!force && lines.length === this.lastLineCount) return;
    const wasAtBottom = this.logBox.scrollTop + this.logBox.clientHeight >= this.logBox.scrollHeight - 20;
    this.lastLineCount = lines.length;
    this.logBox.empty();
    for (const line of lines) {
      this.logBox.createDiv({ cls: `log-${line.level}`, text: `[${line.stamp}] ${line.text}` });
    }
    if (force || wasAtBottom) this.logBox.scrollTop = this.logBox.scrollHeight;
  }

  onClose(): void {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    this.contentEl.empty();
  }
}