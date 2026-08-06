// MEGA Sync — Obsidian plugin entry point.
//
// Wires up: settings, ribbon icon, status bar, commands, sync triggers
// (startup / interval / debounced after changes) and the sync engine.
//
// Secrets handling: MEGA credentials + cached session live in memory only
// (`this.secrets`). At rest they are either stored in plaintext fields (when
// encryption is disabled) or inside an AES-256-GCM blob derived from a master
// passphrase (when enabled). The passphrase itself is never persisted.
import {
  Plugin,
  addIcon,
  Notice,
} from "obsidian";
import { MegaSyncSettings, DEFAULT_SETTINGS, SyncResult, Secrets } from "./sync/types";
import { MegaAdapter } from "./mega/mega-adapter";
import { SyncEngine } from "./sync/engine";
import { Logger } from "./ui/logger";
import { MegaSyncSettingTab, LogModal } from "./settings";
import { encryptSecrets, decryptSecrets } from "./crypto";

const ICON_ID = "mega-sync-icon";
const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`;

export class MegaSyncPlugin extends Plugin {
  settings: MegaSyncSettings = DEFAULT_SETTINGS;
  logger!: Logger;

  /** Decrypted MEGA secrets for the current session (in memory only). */
  secrets: Secrets | null = null;
  /** The master passphrase for the current session (in memory only). */
  passphrase: string | null = null;

  private ribbonEl?: HTMLElement;
  private statusEl?: HTMLElement;
  private intervalId?: number;
  private syncing = false;
  private debounceTimer?: number;

  async onload(): Promise<void> {
    addIcon(ICON_ID, ICON_SVG);

    await this.loadSettings();
    this.logger = new Logger(this, this.settings);
    this.logger.setNoticeHandler((m) => new Notice(m, 4000));

    if (this.settings.showRibbon) this.addRibbon();
    if (this.settings.showStatusBar) this.addStatusBar();

    this.addCommands();
    this.addSettingTab(new MegaSyncSettingTab(this.app, this));

    if (this.settings.syncOnStartup) {
      window.setTimeout(() => { void this.startSync(true); }, 3000);
    }
    this.scheduleInterval();

    if (this.settings.syncOnSave) {
      this.registerEvent(this.app.vault.on("modify", () => this.scheduleDebounced()));
      this.registerEvent(this.app.vault.on("create", () => this.scheduleDebounced()));
      this.registerEvent(this.app.vault.on("delete", () => this.scheduleDebounced()));
      this.registerEvent(this.app.vault.on("rename", () => this.scheduleDebounced()));
    }
  }

  onunload(): void {
    this.clearInterval();
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    // Drop secrets from memory on unload.
    this.secrets = null;
    this.passphrase = null;
  }

  // ----- Settings & secrets -----------------------------------------------

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) || {};
    this.settings = { ...DEFAULT_SETTINGS, ...data };
    if (this.settings.session === undefined) this.settings.session = null;
    if (this.settings.secretsBlob === undefined) this.settings.secretsBlob = null;

    if (this.settings.secretsEncrypted && this.settings.secretsBlob) {
      // Locked: secrets are only available after an unlock.
      this.secrets = null;
      this.passphrase = null;
    } else {
      this.secrets = {
        email: this.settings.email,
        password: this.settings.password,
        secondFactorCode: this.settings.secondFactorCode,
        session: this.settings.session,
      };
    }

    // One-time migration: a legacy plaintext `settingsPassword` (old settings
    // lock) becomes the master passphrase and encrypts the secrets at rest.
    if (
      !this.settings.secretsEncrypted &&
      this.settings.settingsPassword &&
      this.secrets &&
      (this.secrets.email || this.secrets.password || this.secrets.session)
    ) {
      try {
        this.passphrase = this.settings.settingsPassword;
        this.enableEncryptionInternal(this.passphrase);
        await this.saveSettings();
        this.logger.ok("Migrated legacy settings password to encrypted secrets.");
      } catch (e) {
        this.logger.error("Could not migrate legacy settings password.", e);
      }
    }
  }

  async saveSettings(): Promise<void> {
    // Never persist the in-memory passphrase anywhere.
    await this.saveData(this.settings);
  }

  /** Encrypt the current in-memory secrets with `passphrase` and clear the
   *  plaintext fields from the settings object. Caller must saveSettings(). */
  private enableEncryptionInternal(passphrase: string): void {
    if (!this.secrets) throw new Error("No secrets to encrypt — set credentials first.");
    this.settings.secretsBlob = encryptSecrets(this.secrets, passphrase);
    this.settings.secretsEncrypted = true;
    this.settings.email = "";
    this.settings.password = "";
    this.settings.secondFactorCode = "";
    this.settings.session = null;
    this.settings.settingsPassword = "";
    this.passphrase = passphrase;
  }

  /** Public: set a new master passphrase (and encrypt secrets). */
  async setMasterPassphrase(passphrase: string): Promise<void> {
    if (!passphrase) throw new Error("Passphrase cannot be empty.");
    if (!this.secrets || (!this.secrets.email && !this.secrets.password && !this.secrets.session)) {
      throw new Error("Enter your MEGA credentials before enabling encryption.");
    }
    this.enableEncryptionInternal(passphrase);
    await this.saveSettings();
  }

  /** Unlock the encrypted secrets with a passphrase. Throws on wrong passphrase. */
  async unlock(passphrase: string): Promise<void> {
    if (!this.settings.secretsEncrypted || !this.settings.secretsBlob) {
      throw new Error("Secrets are not encrypted.");
    }
    const s = decryptSecrets(this.settings.secretsBlob, passphrase);
    this.secrets = s;
    this.passphrase = passphrase;
  }

  /** Forget the in-memory secrets (keep the encrypted blob at rest). */
  lockNow(): void {
    this.secrets = null;
    this.passphrase = null;
  }

  /** Disable encryption: decrypt, write secrets back to plaintext fields, drop
   *  the blob. Requires a valid passphrase (i.e. must be unlocked first). */
  async disableEncryption(passphrase: string): Promise<void> {
    await this.unlock(passphrase);
    if (!this.secrets) throw new Error("Unlock failed.");
    this.settings.secretsEncrypted = false;
    this.settings.secretsBlob = null;
    this.settings.email = this.secrets.email;
    this.settings.password = this.secrets.password;
    this.settings.secondFactorCode = this.secrets.secondFactorCode;
    this.settings.session = this.secrets.session;
    this.passphrase = null;
    await this.saveSettings();
  }

  /** Persist the current in-memory secrets: re-encrypt (if encryption on) or
   *  update the plaintext fields (if off). */
  async persistSecrets(): Promise<void> {
    if (!this.secrets) return;
    if (this.settings.secretsEncrypted) {
      if (!this.passphrase) {
        // Can't re-encrypt without the passphrase; keep the existing blob.
        this.logger.warn("Secrets changed but no passphrase in memory — not re-encrypting.");
        return;
      }
      this.settings.secretsBlob = encryptSecrets(this.secrets, this.passphrase);
    } else {
      this.settings.email = this.secrets.email;
      this.settings.password = this.secrets.password;
      this.settings.secondFactorCode = this.secrets.secondFactorCode;
      this.settings.session = this.secrets.session;
    }
    await this.saveSettings();
  }

  isLocked(): boolean {
    return this.settings.secretsEncrypted && this.secrets === null;
  }

  // ----- UI ---------------------------------------------------------------

  addRibbon(): void {
    this.ribbonEl = this.addRibbonIcon(ICON_ID, "MEGA Sync — sync now", () => {
      void this.startSync(false);
    });
    this.ribbonEl.addClass("mega-sync-ribbon");
  }

  addStatusBar(): void {
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mega-sync-statusbar");
    this.statusEl.setText("MEGA: ready");
    this.statusEl.onClickEvent(() => { void this.startSync(false); });
  }

  setStatus(text: string, cls?: string): void {
    if (this.statusEl) {
      this.statusEl.setText(`MEGA: ${text}`);
      this.statusEl.className = "mega-sync-statusbar" + (cls ? " " + cls : "");
    }
  }

  applyUiVisibility(): void {
    if (this.settings.showRibbon && !this.ribbonEl) {
      this.addRibbon();
    } else if (!this.settings.showRibbon && this.ribbonEl) {
      this.ribbonEl.remove();
      this.ribbonEl = undefined;
    }
    if (this.statusEl) {
      if (this.settings.showStatusBar) this.statusEl.removeClass("mega-hidden");
      else this.statusEl.addClass("mega-hidden");
    } else if (this.settings.showStatusBar) {
      this.addStatusBar();
    }
    this.logger.configure(this.settings);
  }

  addCommands(): void {
    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => this.startSync(false).catch(() => {}),
    });
    this.addCommand({
      id: "show-log",
      name: "Show sync log",
      callback: () => this.openLogModal(),
    });
    this.addCommand({
      id: "test-connection",
      name: "Test MEGA connection",
      callback: () => this.testConnection(),
    });
    this.addCommand({
      id: "lock",
      name: "Lock secrets now",
      callback: () => {
        this.lockNow();
        new Notice("MEGA Sync secrets locked.");
        this.setStatus("locked");
      },
    });
  }

  openLogModal(): void {
    new LogModal(this.app, this).open();
  }

  // ----- Triggers ----------------------------------------------------------

  scheduleInterval(): void {
    this.clearInterval();
    const min = this.settings.syncIntervalMinutes;
    if (min && min > 0) {
      this.intervalId = window.setInterval(
        () => this.startSync(true).catch(() => {}),
        min * 60 * 1000,
      );
    }
  }

  clearInterval(): void {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  scheduleDebounced(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(
      () => {
        this.debounceTimer = undefined;
        void this.startSync(true);
      },
      Math.max(500, this.settings.syncOnSaveDebounceMs),
    );
  }

  // ----- Sync --------------------------------------------------------------

  private isOnline(): boolean {
    if (!this.settings.syncOnlyIfOnline) return true;
    return navigator.onLine;
  }

  /** Build a MegaAdapter from the in-memory secrets. */
  private buildAdapter(): MegaAdapter {
    if (!this.secrets) throw new Error("Secrets are not unlocked.");
    return new MegaAdapter(this.logger, {
      email: this.secrets.email,
      password: this.secrets.password,
      secondFactorCode: this.secrets.secondFactorCode,
      baseFolder: this.settings.baseFolder,
      remoteSubFolder: this.settings.remoteSubFolder,
      session: this.secrets.session,
    });
  }

  async startSync(automatic: boolean): Promise<void> {
    if (this.syncing) {
      this.logger.info("Sync already running — skipping.");
      return;
    }
    if (this.isLocked()) {
      this.setStatus("locked");
      if (!automatic) {
        new Notice("MEGA Sync is locked. Open its settings and enter your master passphrase.", 8000);
      } else {
        this.logger.info("Locked — skipping automatic sync.");
      }
      return;
    }
    if (!this.secrets || !this.secrets.email || !this.secrets.password) {
      if (!this.secrets?.session?.sid) {
        if (!automatic) {
          new Notice("MEGA Sync: configure your MEGA credentials in settings first.");
        }
        return;
      }
    }
    if (!this.isOnline()) {
      this.logger.info("Offline — skipping automatic sync.");
      this.setStatus("offline");
      return;
    }

    this.syncing = true;
    this.setStatus("syncing…", "syncing");
    const mega = this.buildAdapter();
    const engine = new SyncEngine(this.app, this.settings, mega, this.logger);

    try {
      const result: SyncResult = await engine.run();

      // Cache the session so the next sync can skip the password login.
      const session = mega.getSession();
      if (session && session.sid && session.key) {
        if (this.secrets) this.secrets.session = session;
        await this.persistSecrets();
        this.logger.info(mega.revived ? "Session reused." : "Session cached for next sync.");
      }

      this.settings.lastSnapshot = (await mega.readSnapshot()) ?? this.settings.lastSnapshot;
      await this.saveSettings();
      await this.logger.flushFile();

      this.setStatus(
        `synced ${new Date().toLocaleTimeString()} (↑${result.uploaded} ↓${result.downloaded})`,
      );
      if (result.errors > 0) {
        new Notice(`MEGA Sync finished with ${result.errors} error(s). Open the log.`, 8000);
      } else if (!automatic) {
        new Notice(
          `MEGA Sync done — ↑${result.uploaded} ↓${result.downloaded} ` +
            `delR:${result.deletedRemote} delL:${result.deletedLocal} ` +
            `conflicts:${result.conflicts}`,
          6000,
        );
      }
    } catch (e) {
      this.logger.error("Sync failed.", e);
      this.setStatus("error");
      new Notice(`MEGA Sync failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
    } finally {
      await mega.close();
      this.syncing = false;
    }
  }

  async testConnection(): Promise<void> {
    if (this.isLocked()) {
      new Notice("Unlock MEGA Sync (settings → master passphrase) first.");
      return;
    }
    if (!this.secrets || (!this.secrets.email && !this.secrets.session?.sid)) {
      new Notice("Set your MEGA credentials first.");
      return;
    }
    new Notice("Testing MEGA connection…");
    const mega = this.buildAdapter();
    try {
      await mega.connect();
      await mega.resolveBase();
      const files = await mega.listRemote();
      new Notice(`MEGA OK — base folder reachable, ${files.size} file(s) present.`, 6000);

      const session = mega.getSession();
      if (session && session.sid && session.key && this.secrets) {
        this.secrets.session = session;
        await this.persistSecrets();
      }
    } catch (e) {
      new Notice(`MEGA connection failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
      this.logger.error("Connection test failed.", e);
    } finally {
      await mega.close();
    }
  }
}