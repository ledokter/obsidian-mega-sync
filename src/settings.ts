// Settings UI — mirrors Remotely Save's options, restricted to MEGA.
import { App, PluginSettingTab, Setting, Modal, Notice } from "obsidian";
import { MegaSyncPlugin } from "./main";
import { DEFAULT_SETTINGS, MegaSyncSettings } from "./sync/types";

export class MegaSyncSettingTab extends PluginSettingTab {
  plugin: MegaSyncPlugin;
  private unlocked = false;

  constructor(app: App, plugin: MegaSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    if (this.plugin.settings.settingsPassword && !this.unlocked) {
      this.renderLock();
      return;
    }

    this.renderHeader();
    this.renderCredentials();
    this.renderRemoteFolder();
    this.renderSyncTriggers();
    this.renderFilters();
    this.renderConflict();
    this.renderUi();
    this.renderDanger();
  }

  private renderLock(): void {
    const { containerEl } = this;
    containerEl.createEl("h2", { text: "MEGA Sync — settings locked" });
    new Setting(containerEl)
      .setName("Settings password")
      .setDesc("Enter the password you set to unlock this settings panel.")
      .addText((t) =>
        t.inputEl.setAttribute("type", "password"),
      )
      .addButton((b) => {
        b.setButtonText("Unlock").onClick(() => {
          const input = containerEl.querySelector("input[type=password]") as HTMLInputElement;
          if (input.value === this.plugin.settings.settingsPassword) {
            this.unlocked = true;
            this.display();
          } else {
            new Notice("Wrong settings password.");
          }
        });
      });
  }

  private renderHeader(): void {
    const { containerEl } = this;
    containerEl.createEl("h2", { text: "MEGA Sync" });
    containerEl.createEl("p", {
      text: "Two-way synchronisation between this vault and a folder on your MEGA.nz account. Inspired by Remotely Save, MEGA-only.",
    });
  }

  private renderCredentials(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "MEGA account" });

    new Setting(containerEl)
      .setName("Email")
      .setDesc("Your MEGA account email.")
      .addText((t) =>
        t
          .setPlaceholder("you@example.com")
          .setValue(this.plugin.settings.email)
          .onChange((v) => this.apply("email", v)),
      );

    new Setting(containerEl)
      .setName("Password")
      .setDesc("Your MEGA account password. Stored locally in this vault's plugin data. Use a settings password to lock this panel.")
      .addText((t) => {
        t.inputEl.setAttribute("type", "password");
        t.setValue(this.plugin.settings.password)
          .onChange((v) => this.apply("password", v));
      });

    new Setting(containerEl)
      .setName("2FA code (optional)")
      .setDesc("If you have two-factor authentication enabled on MEGA, enter the current code. Leave blank otherwise. Needed only at login time.")
      .addText((t) =>
        t
          .setPlaceholder("123456")
          .setValue(this.plugin.settings.secondFactorCode)
          .onChange((v) => this.apply("secondFactorCode", v)),
      );

    new Setting(containerEl)
      .setName("Settings password")
      .setDesc("Optional passphrase required to open this settings panel. Leave blank to disable.")
      .addText((t) => {
        t.inputEl.setAttribute("type", "password");
        t.setValue(this.plugin.settings.settingsPassword)
          .onChange((v) => this.apply("settingsPassword", v));
      });

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Connect to MEGA and list the base folder to verify the credentials.")
      .addButton((b) =>
        b.setButtonText("Test").onClick(async () => {
          await this.plugin.testConnection();
        }),
      );
  }

  private renderRemoteFolder(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Remote folder" });

    new Setting(containerEl)
      .setName("Base folder")
      .setDesc("Folder created at the root of your MEGA drive used as the sync container.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.baseFolder)
          .onChange((v) => this.apply("baseFolder", v || DEFAULT_SETTINGS.baseFolder)),
      );

    new Setting(containerEl)
      .setName("Remote sub-folder")
      .setDesc("Optional sub-folder inside the base folder. Useful to sync multiple vaults to the same MEGA folder with different names.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.remoteSubFolder)
          .onChange((v) => this.apply("remoteSubFolder", v)),
      );
  }

  private renderSyncTriggers(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Sync triggers" });

    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc("Start a sync automatically when Obsidian opens.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.syncOnStartup)
          .onChange((v) => this.apply("syncOnStartup", v)),
      );

    new Setting(containerEl)
      .setName("Auto-sync interval")
      .setDesc("Sync every N minutes while Obsidian is open. 0 disables.")
      .addText((t) =>
        t
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange((v) => this.apply("syncIntervalMinutes", Math.max(0, parseInt(v) || 0))),
      );

    new Setting(containerEl)
      .setName("Sync after changes")
      .setDesc("Start a debounced sync shortly after the vault changes.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.syncOnSave)
          .onChange((v) => this.apply("syncOnSave", v)),
      );

    new Setting(containerEl)
      .setName("Debounce (ms)")
      .setDesc("Wait this long after the last change before syncing.")
      .addText((t) =>
        t
          .setPlaceholder("5000")
          .setValue(String(this.plugin.settings.syncOnSaveDebounceMs))
          .onChange((v) => this.apply("syncOnSaveDebounceMs", Math.max(500, parseInt(v) || 5000))),
      );

    new Setting(containerEl)
      .setName("Only when online")
      .setDesc("Skip automatic syncs when Obsidian reports it is offline.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.syncOnlyIfOnline)
          .onChange((v) => this.apply("syncOnlyIfOnline", v)),
      );
  }

  private renderFilters(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "What to sync" });

    new Setting(containerEl)
      .setName("Sync vault config (.obsidian)")
      .setDesc("Include the .obsidian folder so settings, themes and plugins are mirrored across devices.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.syncVaultConfig)
          .onChange((v) => this.apply("syncVaultConfig", v)),
      );

    new Setting(containerEl)
      .setName("Exclude patterns")
      .setDesc("Glob patterns (one per line) of paths to exclude. Supports * and **. e.g. .trash/** or *.tmp")
      .addTextArea((t) => {
        t
          .setValue(this.plugin.settings.excludePatterns)
          .onChange((v) => this.apply("excludePatterns", v));
        t.inputEl.rows = 6;
        t.inputEl.style.width = "100%";
      });

    new Setting(containerEl)
      .setName("Include patterns (override)")
      .setDesc("Paths matching these patterns are synced even if excluded above.")
      .addTextArea((t) => {
        t
          .setValue(this.plugin.settings.includePatterns)
          .onChange((v) => this.apply("includePatterns", v));
        t.inputEl.rows = 3;
        t.inputEl.style.width = "100%";
      });

    new Setting(containerEl)
      .setName("Max file size (MB)")
      .setDesc("Skip files larger than this. 0 = no limit.")
      .addText((t) =>
        t
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.maxFileMb))
          .onChange((v) => this.apply("maxFileMb", Math.max(0, parseInt(v) || 0))),
      );

    new Setting(containerEl)
      .setName("Sync hidden files")
      .setDesc("Include dotfiles and files inside hidden folders (other than those excluded above).")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.syncHiddenFiles)
          .onChange((v) => this.apply("syncHiddenFiles", v)),
      );
  }

  private renderConflict(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Conflicts & deletion" });

    new Setting(containerEl)
      .setName("Conflict folder")
      .setDesc("Name of the local folder where conflict copies are stored.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.conflictFolder)
          .onChange((v) => this.apply("conflictFolder", v || DEFAULT_SETTINGS.conflictFolder)),
      );

    new Setting(containerEl)
      .setName("Use trash for deletion")
      .setDesc("Move deleted local files to the system trash instead of deleting permanently.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.useTrashForDeletion)
          .onChange((v) => this.apply("useTrashForDeletion", v)),
      );
  }

  private renderUi(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Interface" });

    new Setting(containerEl)
      .setName("Status bar")
      .setDesc("Show a sync status item in the status bar.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showStatusBar)
          .onChange((v) => this.apply("showStatusBar", v)),
      );

    new Setting(containerEl)
      .setName("Ribbon icon")
      .setDesc("Show a sync button in the left ribbon.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showRibbon)
          .onChange((v) => this.apply("showRibbon", v)),
      );

    new Setting(containerEl)
      .setName("Keep log file")
      .setDesc("Keep a ring-buffered log in the plugin data folder.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.keepLogFile)
          .onChange((v) => this.apply("keepLogFile", v)),
      );

    new Setting(containerEl)
      .setName("Log lines")
      .setDesc("How many log lines to keep in memory.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.logLines))
          .onChange((v) => this.apply("logLines", Math.max(50, parseInt(v) || 500))),
      );
  }

  private renderDanger(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Maintenance" });

    new Setting(containerEl)
      .setName("Show sync log")
      .setDesc("Open the recent sync log.")
      .addButton((b) =>
        b.setButtonText("Open log").onClick(() => this.plugin.openLogModal()),
      );

    new Setting(containerEl)
      .setName("Reset local snapshot")
      .setDesc("Forget the locally cached sync snapshot. The remote snapshot (if any) is still used, so a first sync after this is treated as a merge, not a fresh sync.")
      .addButton((b) =>
        b
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.lastSnapshot = undefined;
            await this.plugin.saveSettings();
            new Notice("Local snapshot reset.");
          }),
      );

    new Setting(containerEl)
      .setName("Reset all settings")
      .setDesc("Restore the default configuration. Does NOT delete your files.")
      .addButton((b) =>
        b
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings = { ...DEFAULT_SETTINGS };
            await this.plugin.saveSettings();
            this.display();
            new Notice("Settings reset to defaults.");
          }),
      );
  }

  private async apply<K extends keyof MegaSyncSettings>(
    key: K,
    value: MegaSyncSettings[K],
  ): Promise<void> {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
    this.plugin.applyUiVisibility();
  }
}

/** Modal showing the recent sync log lines. */
export class LogModal extends Modal {
  plugin: MegaSyncPlugin;
  constructor(app: App, plugin: MegaSyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("MEGA Sync — log");
    this.modalEl.addClass("mega-sync-log-modal");
    const box = contentEl.createDiv({ cls: "mega-sync-log" });
    for (const line of this.plugin.logger.getLines()) {
      const row = box.createEl("div", {
        cls: `log-${line.level}`,
        text: `[${line.stamp}] ${line.text}`,
      });
      row.setAttribute("data-level", line.level);
    }
    box.scrollTop = box.scrollHeight;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}