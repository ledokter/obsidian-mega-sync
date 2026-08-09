// Informational modal shown before the very first sync for a vault (either
// bootstrap direction — see engine.ts). Purely informational: it does not
// block the sync, which starts in parallel — the user can dismiss it anytime.
import { App, Modal } from "obsidian";

export class FirstSyncModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("MEGA Sync — first sync starting");
    this.modalEl.addClass("mega-sync-firstsync-modal");

    contentEl.createEl("p", {
      text: "This is the first sync for this vault. Depending on its size and your connection speed, it can take a while — keep Obsidian open and in the foreground until it finishes.",
    });
    contentEl.createEl("p", {
      text: "A screen wake lock has been requested automatically where the platform supports it, but it isn't guaranteed to work in every mobile browser context. For a reliable result, also apply the steps below for your device.",
    });

    contentEl.createEl("h4", { text: "Android" });
    const androidList = contentEl.createEl("ul");
    androidList.createEl("li", { text: "Settings → Apps → Obsidian → Battery → set to \"Unrestricted\" (disables battery optimization for the app)." });
    androidList.createEl("li", { text: "Settings → Display → Screen timeout → increase it, or plug in the charger, for the duration of this sync." });

    contentEl.createEl("h4", { text: "iOS" });
    const iosList = contentEl.createEl("ul");
    iosList.createEl("li", { text: "Settings → Display & Brightness → Auto-Lock → Never (remember to revert this afterwards)." });
    iosList.createEl("li", { text: "Keep the Obsidian app in the foreground — iOS suspends network activity for backgrounded apps, which will stall the sync." });

    const closeBtn = contentEl.createEl("button", { text: "Got it", cls: "mod-cta" });
    closeBtn.onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
