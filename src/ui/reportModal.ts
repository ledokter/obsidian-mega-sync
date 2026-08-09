// Sync report: persisted history of runs + recent individual file transfers.
// Modeled on LogModal (settings.ts) — same plain-DOM idiom, but no interval
// refresh: this shows a point-in-time snapshot of already-persisted data,
// not a running sync.
import { App, Modal } from "obsidian";
import { MegaSyncPlugin } from "../main";
import { formatDuration } from "../util";

function directionArrow(dir: "upload" | "download" | "deleteRemote" | "deleteLocal"): string {
  switch (dir) {
    case "upload": return "↑";
    case "download": return "↓";
    case "deleteRemote": return "×R";
    case "deleteLocal": return "×L";
  }
}

export class SyncReportModal extends Modal {
  plugin: MegaSyncPlugin;

  constructor(app: App, plugin: MegaSyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("MEGA Sync — sync report");
    this.modalEl.addClass("mega-sync-report-modal");

    const history = this.plugin.settings.syncHistory;
    const transfers = this.plugin.settings.recentTransfers;

    // Cumulative totals across all recorded runs.
    const totals = history.reduce(
      (acc, r) => {
        acc.runs++;
        acc.uploaded += r.uploaded;
        acc.downloaded += r.downloaded;
        acc.deletedRemote += r.deletedRemote;
        acc.deletedLocal += r.deletedLocal;
        acc.errors += r.errors;
        return acc;
      },
      { runs: 0, uploaded: 0, downloaded: 0, deletedRemote: 0, deletedLocal: 0, errors: 0 },
    );

    const summary = contentEl.createDiv({ cls: "mega-sync-report-summary" });
    if (history.length === 0) {
      summary.createEl("p", { text: "No sync has been recorded yet." });
    } else {
      const last = history[0];
      summary.createEl("p", {
        text: `${totals.runs} run(s) recorded — ↑${totals.uploaded} ↓${totals.downloaded} `
          + `delR:${totals.deletedRemote} delL:${totals.deletedLocal} errors:${totals.errors}.`,
      });
      summary.createEl("p", {
        cls: "mega-text-muted",
        text: `Last sync: ${new Date(last.startedAt).toLocaleString()} `
          + `(${last.stopped ? "stopped" : last.errors > 0 ? "finished with errors" : "ok"}, ${formatDuration(last.durationMs)}).`,
      });
    }

    contentEl.createEl("h4", { text: "Recent runs" });
    const runsBox = contentEl.createDiv({ cls: "mega-sync-report-list" });
    if (history.length === 0) {
      runsBox.createEl("p", { cls: "mega-text-muted", text: "Nothing yet." });
    } else {
      for (const r of history) {
        const line = runsBox.createDiv({ cls: "mega-sync-report-row" });
        const status = r.stopped ? "stopped" : r.errors > 0 ? `${r.errors} error(s)` : "ok";
        const boot = r.bootstrapDirection ? ` [bootstrap ${r.bootstrapDirection}]` : "";
        line.setText(
          `${new Date(r.startedAt).toLocaleString()} — ↑${r.uploaded} ↓${r.downloaded} `
            + `delR:${r.deletedRemote} delL:${r.deletedLocal} conflicts:${r.conflicts} merged:${r.merged} `
            + `(${formatDuration(r.durationMs)}, ${status})${boot}`,
        );
      }
    }

    contentEl.createEl("h4", { text: "Recent file transfers" });
    const transfersBox = contentEl.createDiv({ cls: "mega-sync-report-list" });
    if (transfers.length === 0) {
      transfersBox.createEl("p", { cls: "mega-text-muted", text: "Nothing yet." });
    } else {
      for (const t of transfers) {
        const line = transfersBox.createDiv({ cls: "mega-sync-report-row" });
        line.setText(`${directionArrow(t.direction)} ${t.path} — ${new Date(t.at).toLocaleString()}`);
      }
    }

    const toolbar = contentEl.createDiv({ cls: "mega-sync-log-toolbar" });
    const clearBtn = toolbar.createEl("button", { text: "Clear history", cls: "mod-warning" });
    clearBtn.onclick = () => {
      void (async () => {
        this.plugin.settings.syncHistory = [];
        this.plugin.settings.recentTransfers = [];
        await this.plugin.saveSettings();
        this.onClose();
        this.onOpen();
      })();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
