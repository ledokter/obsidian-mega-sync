// Shared path filter used by both the local inventory walk and the remote
// inventory post-filter, so exclusion rules apply consistently on both sides.
//
// Model (mirrors Remotely Save's checkIsSkipItemOrNotByName, simplified):
//   1. always-skipped basenames/folders (.git, node_modules, .DS_Store, …)
//   2. hidden segments: dot-prefixed (toggle: syncHiddenFiles) and
//      underscore-prefixed (toggle: syncUnderscoreItems)
//   3. regex ignore list (ignorePathsRegex)
//   4. regex allow list (onlyAllowPathsRegex) — when non-empty, a path must
//      match at least one regex or it is skipped
//
// The glob exclude/include patterns (excludePatterns / includePatterns) and
// the config-folder / bookmarks policy are handled separately in
// LocalInventory, because they are local-walk-time decisions (folder descent,
// config dir). The rules here are the symmetric ones applied to BOTH sides.
import type { MegaSyncSettings } from "./types";

/** Basenames / folder names always excluded, regardless of settings. */
const ALWAYS_SKIPPED_NAMES = new Set([
  ".git",
  ".github",
  ".gitlab",
  ".svn",
  "node_modules",
  ".DS_Store",
  "__MACOSX",
  "desktop.ini",
  "Desktop.ini",
  "thumbs.db",
  "Thumbs.db",
  // The legacy "Icon\r" resource-fork file (carriage return in the name).
  "Icon\r",
]);

/** Basename prefixes for Microsoft Office temp files (~$foo.docx, …). */
const OFFICE_TEMP_PREFIX = "~$";

/**
 * Path filter constructed once per sync run from the current settings.
 * Cheap to call per-path: a couple of Set lookups + a few regex tests.
 */
export class PathFilter {
  private readonly allowDot: boolean;
  private readonly allowUnderscore: boolean;
  private readonly ignore: RegExp[];
  private readonly allow: RegExp[];

  constructor(settings: MegaSyncSettings) {
    this.allowDot = settings.syncHiddenFiles;
    this.allowUnderscore = settings.syncUnderscoreItems;
    this.ignore = compileRegexes(settings.ignorePathsRegex);
    this.allow = compileRegexes(settings.onlyAllowPathsRegex);
  }

  /** Whether `allow` mode (onlyAllowPathsRegex non-empty) is active. */
  get hasAllowList(): boolean {
    return this.allow.length > 0;
  }

  /** A path is allowed by the allowlist if it matches an allow regex OR is a
   *  child of a parent that matches (so deep files don't get pruned). */
  private matchesAllow(path: string): boolean {
    for (const re of this.allow) {
      if (re.test(path)) return true;
    }
    // Check whether any ancestor is itself allowed.
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      for (const re of this.allow) {
        if (re.test(parent)) return true;
      }
    }
    return false;
  }

  /** True if the path must be skipped (excluded from sync). */
  shouldSkip(path: string): boolean {
    const norm = path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (norm === "" || norm === "/") return true;

    const segments = norm.split("/");
    for (const seg of segments) {
      if (ALWAYS_SKIPPED_NAMES.has(seg)) return true;
      if (seg.startsWith(OFFICE_TEMP_PREFIX)) return true;
      // Hidden segment rules.
      if (!this.allowDot && seg.startsWith(".")) return true;
      if (!this.allowUnderscore && seg.startsWith("_")) return true;
    }

    for (const re of this.ignore) {
      if (re.test(norm)) return true;
    }

    if (this.hasAllowList && !this.matchesAllow(norm)) return true;

    return false;
  }
}

/** Compile a multiline string of regexes (one per line) into RegExp[].
 *  Invalid lines are silently skipped (a sync must not crash on a bad regex). */
function compileRegexes(multiline: string): RegExp[] {
  const out: RegExp[] = [];
  for (const raw of multiline.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(new RegExp(line));
    } catch {
      // Ignore invalid regex — do not break the sync.
    }
  }
  return out;
}