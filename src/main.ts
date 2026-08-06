// MEGA Sync — Obsidian plugin entry point.
//
// Wires up: settings, ribbon icon, status bar, commands, sync triggers
// (startup / interval / debounced after changes) and the sync engine.
import {
  Plugin,
  addIcon,
  Notice,
  setIcon,
  MenuItem,
} from "obsidian";
import { MegaSyncSettings, DEFAULT_SETTINGS, SyncResult } from "./sync/types";
import { MegaAdapter } from "./mega/mega-adapter";
import { SyncEngine } from "./sync/engine";
import { Logger } from "./ui/logger";
import { MegaSyncSettingTab, LogModal } from "./settings";

const ICON_ID = "mega-sync-icon";
const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`;

export class MegaSyncPlugin extends Plugin {
  settings: MegaSyncSettings = DEFAULT_SETTINGS;
  logger!: Logger;
  private ribbonEl?: HTMLElement;
  private statusEl?: HTMLElement;
  private intervalId?: number;
  private syncing = false;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  async onload(): Promise<void> {
    addIcon(ICON_ID, ICON_SVG);

    await this.loadSettings();
    this.logger = new Logger(this, this.settings);
    this.logger.setNoticeHandler((m) => new Notice(m, 4000));

    // Ribbon icon.
    if (this.settings.showRibbon) this.addRibbon();

    // Status bar.
    if (this.settings.showStatusBar) this.addStatusBar();

    // Commands.
    this.addCommands();

    // Settings tab.
    this.addSettingTab(new MegaSyncSettingTab(this.app, this));

    // Sync triggers.
    if (this.settings.syncOnStartup) {
      // Defer slightly so the vault is fully loaded.
      setTimeout(() => this.startSync(true).catch(() => {}), 3000);
    }
    this.scheduleInterval();

    if (this.settings.syncOnSave) {
      this.registerEvent(
        this.app.vault.on("modify", () => this.scheduleDebounced()),
      );
      this.registerEvent(
        this.app.vault.on("create", () => this.scheduleDebounced()),
      );
      this.registerEvent(
        this.app.vault.on("delete", () => this.scheduleDebounced()),
      );
      this.registerEvent(
        this.app.vault.on("rename", () => this.scheduleDebounced()),
      );
    }

    // Status bar click → sync.
  }

  onunload(): void {
    this.clearInterval();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  // ----- Settings -----------------------------------------------------------

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) || {};
    this.settings = { ...DEFAULT_SETTINGS, ...data };
    // Never let the user accidentally sync the plugin's own data file.
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ----- UI -----------------------------------------------------------------

  addRibbon(): void {
    this.ribbonEl = this.addRibbonIcon(ICON_ID, "MEGA Sync — sync now", () =>
      this.startSync(false).catch(() => {}),
    );
    this.ribbonEl.addClass("mega-sync-ribbon");
  }

  addStatusBar(): void {
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mega-sync-statusbar");
    this.statusEl.setText("MEGA: ready");
    this.statusEl.onClickEvent(() => this.startSync(false).catch(() => {}));
  }

  setStatus(text: string, cls?: string): void {
    if (this.statusEl) {
      this.statusEl.setText(`MEGA: ${text}`);
      this.statusEl.className = "mega-sync-statusbar" + (cls ? " " + cls : "");
    }
  }

  applyUiVisibility(): void {
    // Refresh ribbon visibility.
    if (this.settings.showRibbon && !this.ribbonEl) {
      this.addRibbon();
    } else if (!this.settings.showRibbon && this.ribbonEl) {
      this.ribbonEl.remove();
      this.ribbonEl = undefined;
    }
    // Status bar is created/destroyed less often; toggle via display.
    if (this.statusEl) {
      this.statusEl.style.display = this.settings.showStatusBar ? "" : "none";
    } else if (this.settings.showStatusBar) {
      this.addStatusBar();
    }
    this.logger.configure(this.settings);
  }

  addCommands(): void {
    this.addCommand({
      id: "mega-sync-now",
      name: "Sync now",
      callback: () => this.startSync(false).catch(() => {}),
    });
    this.addCommand({
      id: "mega-sync-show-log",
      name: "Show sync log",
      callback: () => this.openLogModal(),
    });
    this.addCommand({
      id: "mega-sync-test-connection",
      name: "Test MEGA connection",
      callback: () => this.testConnection(),
    });
  }

  openLogModal(): void {
    new LogModal(this.app, this).open();
  }

  // ----- Triggers -----------------------------------------------------------

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
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = undefined;
        this.startSync(true).catch(() => {});
      },
      Math.max(500, this.settings.syncOnSaveDebounceMs),
    );
  }

  // ----- Sync ---------------------------------------------------------------

  private isOnline(): boolean {
    if (!this.settings.syncOnlyIfOnline) return true;
    return navigator.onLine;
  }

  async startSync(automatic: boolean): Promise<void> {
    if (this.syncing) {
      this.logger.info("Sync already running — skipping.");
      return;
    }
    if (!this.settings.email || !this.settings.password) {
      if (!automatic) {
        new Notice("MEGA Sync: please configure your MEGA credentials first.");
      }
      return;
    }
    if (!this.isOnline()) {
      this.logger.info("Offline — skipping automatic sync.");
      this.setStatus("offline");
      return;
    }

    this.syncing = true;
    this.setStatus("syncing…", "syncing");
    const mega = new MegaAdapter(this.logger, {
      email: this.settings.email,
      password: this.settings.password,
      secondFactorCode: this.settings.secondFactorCode,
      baseFolder: this.settings.baseFolder,
      remoteSubFolder: this.settings.remoteSubFolder,
    });
    const engine = new SyncEngine(this.app, this.settings, mega, this.logger);

    try {
      const result: SyncResult = await engine.run();
      this.settings.lastSnapshot = (await mega.readSnapshot()) ?? this.settings.lastSnapshot;
      await this.saveSettings();
      await this.logger.flushFile();

      this.setStatus(
        `synced ${new Date().toLocaleTimeString()} (↑${result.uploaded} ↓${result.downloaded})`,
      );
      if (result.errors > 0) {
        new Notice(
          `MEGA Sync finished with ${result.errors} error(s). Open the log.`,
          8000,
        );
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
    if (!this.settings.email || !this.settings.password) {
      new Notice("Set your MEGA email and password first.");
      return;
    }
    new Notice("Testing MEGA connection…");
    const mega = new MegaAdapter(this.logger, {
      email: this.settings.email,
      password: this.settings.password,
      secondFactorCode: this.settings.secondFactorCode,
      baseFolder: this.settings.baseFolder,
      remoteSubFolder: this.settings.remoteSubFolder,
    });
    try {
      await mega.connect();
      await mega.resolveBase();
      const files = await mega.listRemote();
      new Notice(
        `MEGA OK — base folder reachable, ${files.size} file(s) present.`,
        6000,
      );
    } catch (e) {
      new Notice(`MEGA connection failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
      this.logger.error("Connection test failed.", e);
    } finally {
      await mega.close();
    }
  }
}