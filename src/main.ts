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
  Modal,
} from "obsidian";
import { MegaSyncSettings, DEFAULT_SETTINGS, SyncResult, Secrets } from "./sync/types";
import { MegaAdapter } from "./mega/mega-adapter";
import { SyncEngine } from "./sync/engine";
import { Logger } from "./ui/logger";
import { MegaSyncSettingTab, LogModal } from "./settings";
import { encryptSecrets, decryptSecrets } from "./crypto";
import { formatDuration } from "./util";

const ICON_ID = "mega-sync-icon";
const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`;

function directionLabel(dir: MegaSyncSettings["syncDirection"]): string {
  switch (dir) {
    case "upload-only":
      return "upload to MEGA (mirror)";
    case "download-only":
      return "download from MEGA (mirror)";
    case "push-only":
      return "push to MEGA (no deletions)";
    case "pull-only":
      return "pull from MEGA (no deletions)";
    default:
      return "two-way sync";
  }
}

/** One-line, human description of what a direction will do. */
function directionDesc(dir: MegaSyncSettings["syncDirection"]): string {
  switch (dir) {
    case "upload-only":
      return "push local files to MEGA and delete remote files no longer present locally (mirror)";
    case "download-only":
      return "pull MEGA files to local and delete local files no longer present remotely (mirror)";
    case "push-only":
      return "push new and modified local files to MEGA. No files are deleted on either side.";
    case "pull-only":
      return "pull new and modified MEGA files to local. No files are deleted on either side.";
    default:
      return "merge changes both ways between the vault and MEGA";
  }
}

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
  /** True while a sync is in progress. Read by LogModal to show the Stop
   *  button / live progress. */
  syncing = false;
  private debounceTimer?: number;
  private currentEngine?: SyncEngine;
  private syncStartedAt = 0;
  /** Latest progress snapshot for the running sync, read by LogModal. */
  lastProgress?: { done: number; total: number; label: string; etaMs: number };

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
    const data = (await this.loadData()) as Partial<MegaSyncSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
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
        await this.enableEncryptionInternal(this.passphrase);
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
  private async enableEncryptionInternal(passphrase: string): Promise<void> {
    if (!this.secrets) throw new Error("No secrets to encrypt — set credentials first.");
    this.settings.secretsBlob = await encryptSecrets(this.secrets, passphrase);
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
    await this.enableEncryptionInternal(passphrase);
    await this.saveSettings();
  }

  /** Unlock the encrypted secrets with a passphrase. Throws on wrong passphrase. */
  async unlock(passphrase: string): Promise<void> {
    if (!this.settings.secretsEncrypted || !this.settings.secretsBlob) {
      throw new Error("Secrets are not encrypted.");
    }
    const s = await decryptSecrets(this.settings.secretsBlob, passphrase);
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
      this.settings.secretsBlob = await encryptSecrets(this.secrets, this.passphrase);
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
    this.ribbonEl = this.addRibbonIcon(ICON_ID, "MEGA Sync — sync now (right-click to stop)", () => {
      void this.startSync(false);
    });
    this.ribbonEl.addClass("mega-sync-ribbon");
    this.ribbonEl.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      if (this.syncing) {
        this.stopSync();
      } else {
        new Notice("MEGA Sync — no sync is running.", 3000);
      }
    });
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
      id: "dry-run",
      name: "Simulate sync (dry run)",
      callback: () => this.dryRun().catch(() => {}),
    });
    this.addCommand({
      id: "show-log",
      name: "Show sync log",
      callback: () => this.openLogModal(),
    });
    this.addCommand({
      id: "stop-sync",
      name: "Stop sync",
      checkCallback: (checking) => {
        if (!this.syncing) return false;
        if (!checking) this.stopSync();
        return true;
      },
    });
    this.addCommand({
      id: "test-connection",
      name: "Test MEGA connection & read/write",
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

  /** Request the running sync to stop. It finishes the in-flight action (or
   *  its per-file timeout, see "Per-file timeout" in settings) then halts —
   *  it cannot cancel an already-hung network request outright, but bounds
   *  how long that takes instead of waiting forever. Whatever was already
   *  synced is kept. */
  stopSync(): void {
    if (!this.syncing || !this.currentEngine) return;
    this.currentEngine.abort();
    this.logger.warn("Stop requested — finishing the current action, then halting.");
    new Notice("MEGA Sync — stopping after the current action…", 5000);
  }

  // ----- Triggers ----------------------------------------------------------

  scheduleInterval(): void {
    this.clearInterval();
    const min = this.settings.syncIntervalMinutes;
    if (min && min > 0) {
      this.intervalId = window.setInterval(
        () => { void this.startSync(true); },
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

  private buildEngine(mega: MegaAdapter): SyncEngine {
    return new SyncEngine(this.app, this.settings, mega, this.logger, this.manifest.dir ?? ".obsidian/plugins/mega-sync");
  }

  /** Confirmation modal shown before manual syncs when enabled. */
  private confirmSync(): Promise<boolean> {
    return new Promise((resolve) => {
      const dir = this.settings.syncDirection;
      const modal = new Modal(this.app);
      modal.titleEl.setText("Sync now?");
      const body = modal.contentEl.createDiv();
      body.createEl("p", { text: `Direction: ${directionLabel(dir)}.` });
      body.createEl("p", { text: directionDesc(dir) });
      body.createEl("p", {
        text: "This may upload, download, and delete files. You can review the result in the sync log afterwards.",
        cls: "mega-text-muted",
      });
      const btnRow = modal.contentEl.createDiv({ cls: "mega-text-right mega-mt-10" });
      const cancel = btnRow.createEl("button", { text: "Cancel" });
      const ok = btnRow.createEl("button", { text: "Sync" });
      ok.classList.add("mod-cta");
      ok.onclick = () => { modal.close(); resolve(true); };
      cancel.onclick = () => { modal.close(); resolve(false); };
      modal.onClose = () => resolve(false);
      modal.open();
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

    // Optional confirmation modal for MANUAL syncs only. Automatic syncs
    // (startup / interval / debounced) are never blocked.
    if (!automatic && this.settings.confirmManualSync) {
      const ok = await this.confirmSync();
      if (!ok) {
        this.logger.info("Sync cancelled by user.");
        return;
      }
    }

    if (this.settings.notifyBeforeSync) {
      new Notice(`MEGA Sync — ${directionLabel(this.settings.syncDirection)}…`, 3000);
    }

    this.syncing = true;
    this.setStatus("syncing…", "syncing");
    this.ribbonEl?.addClass("syncing");
    this.syncStartedAt = Date.now();
    this.lastProgress = undefined;
    const mega = this.buildAdapter();
    const engine = this.buildEngine(mega);
    this.currentEngine = engine;
    engine.setProgress((done, total, label) => {
      const elapsed = Date.now() - this.syncStartedAt;
      const etaMs = done > 0 ? (elapsed / done) * (total - done) : NaN;
      this.lastProgress = { done, total, label, etaMs };
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      this.setStatus(
        `syncing ${pct}% (${done}/${total}) — ~${formatDuration(etaMs)} left`,
        "syncing",
      );
      if (this.ribbonEl) {
        this.ribbonEl.style.setProperty("--mega-progress", String(total > 0 ? done / total : 0));
        this.ribbonEl.setAttribute(
          "aria-label",
          `MEGA Sync — ${pct}% (${done}/${total}), ~${formatDuration(etaMs)} left (right-click to stop)`,
        );
      }
    });

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

      // Auto-bootstrap: the first sync into an empty vault downloaded
      // everything from MEGA. Mark bootstrapped and switch to two-way sync.
      if (result.bootstrapped) {
        this.settings.bootstrapped = true;
        this.settings.syncDirection = "two-way";
        await this.saveSettings();
        new Notice(
          "MEGA Sync — bootstrap complete: vault downloaded. Two-way sync enabled for next syncs.",
          8000,
        );
        this.logger.ok("Bootstrap complete — switched to two-way sync.");
      }

      this.setStatus(
        `${result.stopped ? "stopped" : "synced"} ${new Date().toLocaleTimeString()} ` +
          `(↑${result.uploaded} ↓${result.downloaded})`,
      );
      if (result.stopped) {
        new Notice(
          `MEGA Sync stopped — ↑${result.uploaded} ↓${result.downloaded} ` +
            `delR:${result.deletedRemote} delL:${result.deletedLocal}. Progress was saved.`,
          8000,
        );
      } else if (result.errors > 0) {
        new Notice(`MEGA Sync finished with ${result.errors} error(s). Open the log.`, 8000);
      } else if (!automatic) {
        new Notice(
          `MEGA Sync done — ↑${result.uploaded} ↓${result.downloaded} ` +
            `delR:${result.deletedRemote} delL:${result.deletedLocal} ` +
            `conflicts:${result.conflicts} merged:${result.merged}`,
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
      this.currentEngine = undefined;
      this.lastProgress = undefined;
      this.ribbonEl?.removeClass("syncing");
      this.ribbonEl?.style.removeProperty("--mega-progress");
      this.ribbonEl?.setAttribute("aria-label", "MEGA Sync — sync now (right-click to stop)");
    }
  }

  /** Simulate a sync: build inventories and the plan, log every planned op,
   *  but perform no upload/download/delete and do not update the snapshot. */
  async dryRun(): Promise<void> {
    if (this.isLocked()) {
      new Notice("Unlock MEGA Sync (settings → master passphrase) first.");
      return;
    }
    if (!this.secrets || (!this.secrets.email && !this.secrets.session?.sid)) {
      new Notice("Set your MEGA credentials first.");
      return;
    }
    if (!this.isOnline()) {
      new Notice("Offline — cannot run a dry run.");
      return;
    }
    new Notice(`MEGA Sync — dry run (${directionLabel(this.settings.syncDirection)})…`, 3000);
    const mega = this.buildAdapter();
    const engine = this.buildEngine(mega);
    try {
      const result = await engine.run(true);
      new Notice(
        `Dry run — ↑${result.uploaded} ↓${result.downloaded} ` +
          `delR:${result.deletedRemote} delL:${result.deletedLocal} ` +
          `conflicts:${result.conflicts}. Nothing was changed. Open the log for details.`,
        8000,
      );
    } catch (e) {
      this.logger.error("Dry run failed.", e);
      new Notice(`Dry run failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
    } finally {
      await mega.close();
    }
  }

  /** Connect to MEGA, then write a small test file, read it back, verify the
   *  content matches, and delete it. Validates the full upload/download/delete
   *  path — not just that the base folder is reachable. */
  async testConnection(): Promise<void> {
    if (this.isLocked()) {
      new Notice("Unlock MEGA Sync (settings → master passphrase) first.");
      return;
    }
    if (!this.secrets || (!this.secrets.email && !this.secrets.session?.sid)) {
      new Notice("Set your MEGA credentials first.");
      return;
    }
    new Notice("Testing MEGA connection & read/write…");
    const mega = this.buildAdapter();
    let testPath = "";
    try {
      await mega.connect();
      await mega.resolveBase();
      const files = await mega.listRemote();

      // Round-trip: write a unique marker, read it back, verify, then clean up.
      const marker = `mega-sync-rttest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      testPath = `${marker}.txt`;
      await mega.upload(testPath, Buffer.from(marker, "utf8"));
      const buf = await mega.download(testPath);
      const got = buf.toString("utf8");
      if (got !== marker) {
        throw new Error(`Round-trip mismatch (wrote ${marker.length} bytes, read "${got.slice(0, 40)}").`);
      }
      await mega.deleteRemote(testPath);
      testPath = "";

      new Notice(
        `MEGA OK — round-trip write/read verified, test file cleaned up. ${files.size} file(s) in base folder.`,
        6000,
      );
      this.logger.ok("Round-trip test passed: upload + download + delete OK.");

      const session = mega.getSession();
      if (session && session.sid && session.key && this.secrets) {
        this.secrets.session = session;
        await this.persistSecrets();
      }
    } catch (e) {
      new Notice(`MEGA test failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
      this.logger.error("Connection / round-trip test failed.", e);
    } finally {
      // Best-effort cleanup of the test file if something failed mid-way.
      if (testPath) {
        try { await mega.deleteRemote(testPath); } catch { /* ignore */ }
      }
      await mega.close();
    }
  }
}