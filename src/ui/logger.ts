// Lightweight logger: ring buffer + optional on-disk log file + Obsidian notices.
import { MegaSyncSettings } from "../sync/types";
import { nowStamp } from "../util";

export type LogLevel = "info" | "ok" | "warn" | "error";

export interface LogLine {
  level: LogLevel;
  text: string;
  stamp: string;
}

export class Logger {
  private buffer: LogLine[] = [];
  private max: number;
  private keepFile: boolean;
  private enabled: boolean;
  private plugin: { loadData: () => Promise<Record<string, unknown> | null>; saveData: (d: Record<string, unknown>) => Promise<void> };
  private fileLog: string[] = [];
  private onNotice?: (msg: string, timeout?: number) => void;

  constructor(
    plugin: { loadData: () => Promise<any>; saveData: (d: any) => Promise<void> },
    settings: MegaSyncSettings,
  ) {
    this.plugin = plugin;
    this.max = settings.logLines;
    this.keepFile = settings.keepLogFile;
    this.enabled = settings.enableLogging;
  }

  configure(settings: MegaSyncSettings): void {
    this.max = settings.logLines;
    this.keepFile = settings.keepLogFile;
    this.enabled = settings.enableLogging;
  }

  setNoticeHandler(fn: (msg: string, timeout?: number) => void): void {
    this.onNotice = fn;
  }

  log(level: LogLevel, msg: string): void {
    if (!this.enabled) return;
    const line: LogLine = { level, text: msg, stamp: nowStamp() };
    this.buffer.push(line);
    if (this.buffer.length > this.max) this.buffer.shift();
    if (this.keepFile) this.fileLog.push(`[${line.stamp}] ${level.toUpperCase()} ${msg}`);
  }

  info(msg: string): void {
    this.log("info", msg);
  }
  ok(msg: string): void {
    this.log("ok", msg);
  }
  warn(msg: string): void {
    this.log("warn", msg);
  }
  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err ?? "");
    this.log("error", `${msg}${detail ? " — " + detail : ""}`);
  }

  notice(msg: string, timeout?: number): void {
    this.info(msg);
    this.onNotice?.(msg, timeout);
  }

  getLines(): LogLine[] {
    return [...this.buffer];
  }

  /** Persist the on-disk log to plugin data.json under `megaSyncLog`. */
  async flushFile(): Promise<void> {
    if (!this.keepFile || this.fileLog.length === 0) return;
    const loaded = await this.plugin.loadData();
    const data: Record<string, unknown> = loaded ?? {};
    const existing: unknown = data.megaSyncLog;
    const merged = (Array.isArray(existing) ? (existing as string[]) : []).concat(this.fileLog).slice(-2000);
    data.megaSyncLog = merged;
    await this.plugin.saveData(data);
    this.fileLog = [];
  }
}