// Settings UI — mirrors Remotely Save's options, restricted to MEGA, plus
// a master-passphrase panel that encrypts the MEGA credentials + cached
// session at rest (AES-256-GCM).
import { App, PluginSettingTab, Setting, Modal, Notice } from "obsidian";
import { MegaSyncPlugin } from "./main";
import { DEFAULT_SETTINGS, MegaSyncSettings } from "./sync/types";

export class MegaSyncSettingTab extends PluginSettingTab {
  plugin: MegaSyncPlugin;

  constructor(app: App, plugin: MegaSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    if (this.plugin.isLocked()) {
      this.renderUnlock();
      return;
    }

    this.renderHeader();
    this.renderSecurity();
    this.renderCredentials();
    this.renderRemoteFolder();
    this.renderSyncTriggers();
    this.renderFilters();
    this.renderConflict();
    this.renderUi();
    this.renderDanger();
  }

  // ----- Security / encryption --------------------------------------------

  private renderUnlock(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName("MEGA Sync — locked").setHeading();
    containerEl.createEl("p", {
      text: "Your MEGA credentials are encrypted at rest. Enter your master passphrase to unlock.",
    });
    const inputEl = containerEl.createEl("input", { type: "password" });
    inputEl.placeholder = "Master passphrase";
    inputEl.addClass("mega-input-full");
    inputEl.addClass("mega-mb-12");

    const tryUnlock = async () => {
      try {
        await this.plugin.unlock(inputEl.value);
        inputEl.value = "";
        this.display();
      } catch (e) {
        new Notice(e instanceof Error ? e.message : "Wrong passphrase.");
      }
    };
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void tryUnlock();
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Unlock").onClick(tryUnlock),
    );
  }

  private renderSecurity(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName("Security").setHeading();

    const encrypted = this.plugin.settings.secretsEncrypted;
    if (encrypted) {
      new Setting(containerEl)
        .setName("Secrets encrypted")
        .setDesc("Your MEGA email, password, 2FA code and cached session are encrypted at rest with AES-256-GCM. The passphrase is only kept in memory for this session.")
        .addButton((b) =>
          b.setButtonText("Lock now").onClick(() => {
            this.plugin.lockNow();
            new Notice("MEGA Sync locked.");
            this.display();
          }),
        );
      new Setting(containerEl)
        .setName("Disable encryption")
        .setDesc("Decrypt and store secrets in plaintext again. Requires the current passphrase.")
        .addButton((b) => {
          b.setButtonText("Disable").setDestructive().onClick(async () => {
            const pass = await this.askPassphrase("Disable encryption", "Enter current master passphrase");
            if (pass === null) return;
            try {
              await this.plugin.disableEncryption(pass);
              new Notice("Encryption disabled.");
              this.display();
            } catch (e) {
              new Notice(e instanceof Error ? e.message : "Failed.");
            }
          });
        });
    } else {
      new Setting(containerEl)
        .setName("Master passphrase")
        .setDesc("Set a passphrase to encrypt your MEGA credentials and cached session at rest. It will also lock this settings panel. Without it, secrets are stored in plaintext in data.json.")
        .addButton((b) =>
          b.setButtonText("Enable encryption").onClick(async () => {
            const pass = await this.askPassphrase("Set master passphrase", "Choose a passphrase", true);
            if (pass === null) return;
            try {
              await this.plugin.setMasterPassphrase(pass);
              new Notice("Secrets encrypted at rest.");
              this.display();
            } catch (e) {
              new Notice(e instanceof Error ? e.message : "Failed.");
            }
          }),
        );
      new Setting(containerEl)
        .setName("Plaintext warning")
        .setDesc("Until you enable encryption, your MEGA password is stored in clear text inside this vault. Do not commit the config folder to a public repository.")
        .setDisabled(true);
    }
  }

  /** Small prompt modal returning the typed passphrase (or null on cancel). */
  private askPassphrase(
    title: string,
    label: string,
    withConfirm = false,
  ): Promise<string | null> {
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
        if (!v) {
          new Notice("Passphrase cannot be empty.");
          return;
        }
        if (i2 && i2.value !== v) {
          new Notice("Passphrases do not match.");
          return;
        }
        i1.value = "";
        if (i2) i2.value = "";
        modal.close();
        resolve(v);
      };
      ok.onclick = submit;
      i1.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      cancel.onclick = () => {
        modal.close();
        resolve(null);
      };
      modal.onClose = () => resolve(null);
      modal.open();
    });
  }

  // ----- Header & credentials ---------------------------------------------

  private renderHeader(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName("MEGA Sync").setHeading();
    containerEl.createEl("p", {
      text: "Two-way synchronisation between this vault and a folder on your MEGA.nz account. Inspired by Remotely Save, MEGA-only.",
    });
  }

  private renderCredentials(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName("MEGA account").setHeading();

    const s = this.plugin.secrets;
    if (!s) {
      containerEl.createEl("p", { text: "Secrets are not available in this session." });
      return;
    }

    new Setting(containerEl)
      .setName("Email")
      .setDesc("Your MEGA account email.")
      .addText((t) =>
        t
          .setPlaceholder("you@example.com")
          .setValue(s.email)
          .onChange(async (v) => {
            s.email = v;
            await this.plugin.persistSecrets();
          }),
      );

    new Setting(containerEl)
      .setName("Password")
      .setDesc("Your MEGA account password. Stored encrypted at rest if a master passphrase is set.")
      .addText((t) => {
        t.inputEl.setAttribute("type", "password");
        t.setValue(s.password).onChange(async (v) => {
          s.password = v;
          await this.plugin.persistSecrets();
        });
      });

    new Setting(containerEl)
      .setName("2FA code (optional)")
      .setDesc("If you have two-factor authentication on MEGA, enter the current code. Needed only at login time; blank otherwise.")
      .addText((t) =>
        t
          .setPlaceholder("123456")
          .setValue(s.secondFactorCode)
          .onChange(async (v) => {
            s.secondFactorCode = v;
            await this.plugin.persistSecrets();
          }),
      );

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Connect to MEGA and list the base folder to verify the credentials.")
      .addButton((b) =>
        b.setButtonText("Test").onClick(() => this.plugin.testConnection()),
      );
  }

  private renderRemoteFolder(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName("Remote folder").setHeading();

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
    new Setting(containerEl).setName("Sync triggers").setHeading();

    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc("Start a sync automatically when Obsidian opens. Requires unlocking the master passphrase (or no encryption).")
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
    new Setting(containerEl).setName("What to sync").setHeading();

    new Setting(containerEl)
      .setName("Sync vault config")
      .setDesc("Include the config folder so settings, themes and plugins are mirrored across devices.")
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
        t.inputEl.addClass("mega-textarea-full");
      });

    new Setting(containerEl)
      .setName("Include patterns (override)")
      .setDesc("Paths matching these patterns are synced even if excluded above.")
      .addTextArea((t) => {
        t
          .setValue(this.plugin.settings.includePatterns)
          .onChange((v) => this.apply("includePatterns", v));
        t.inputEl.rows = 3;
        t.inputEl.addClass("mega-textarea-full");
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
    new Setting(containerEl).setName("Conflicts & deletion").setHeading();

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
    new Setting(containerEl).setName("Interface").setHeading();

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
    new Setting(containerEl).setName("Maintenance").setHeading();

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
          .setDestructive()
          .onClick(async () => {
            this.plugin.settings.lastSnapshot = undefined;
            await this.plugin.saveSettings();
            new Notice("Local snapshot reset.");
          }),
      );

    new Setting(containerEl)
      .setName("Reset all settings")
      .setDesc("Restore the default configuration. Does NOT delete your files or your encrypted secrets blob.")
      .addButton((b) =>
        b
          .setButtonText("Reset")
          .setDestructive()
          .onClick(async () => {
            const blob = this.plugin.settings.secretsBlob;
            const enc = this.plugin.settings.secretsEncrypted;
            this.plugin.settings = { ...DEFAULT_SETTINGS };
            this.plugin.settings.secretsBlob = blob;
            this.plugin.settings.secretsEncrypted = enc;
            if (!enc) {
              this.plugin.secrets = { email: "", password: "", secondFactorCode: "", session: null };
            }
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
    if (key === "syncIntervalMinutes") this.plugin.scheduleInterval();
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
      box.createDiv({
        cls: `log-${line.level}`,
        text: `[${line.stamp}] ${line.text}`,
      });
    }
    box.scrollTop = box.scrollHeight;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}