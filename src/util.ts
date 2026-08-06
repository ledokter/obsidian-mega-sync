// Small utility helpers used across the plugin.

/** Promise-based delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Debounce a function; trailing edge. Returns a wrapper + a cancel(). */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): T & { cancel: () => void } {
  let timer: number | null = null;
  const wrapped = ((...args: never[]) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as T & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}

/** Normalize a vault path to POSIX with no leading slash. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Join POSIX path segments. */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0)
    .join("/");
}

/**
 * Minimal glob matcher supporting `*` (within a path segment) and `**`
 * (across segments). Patterns are matched against vault-relative POSIX
 * paths. Returns true if the path matches.
 */
export function matchGlob(pattern: string, path: string): boolean {
  // Treat a leading slash as "anchored to root" — strip it, we always match root paths.
  let p = pattern.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.replace(/\\/g, "/").replace(/^\/+/, "");

  // Convert glob to regex.
  let re = "";
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        // ** : match across slashes
        re += ".*";
        i += 2;
        if (p[i] === "/") i++; // consume optional trailing slash
      } else {
        // * : match within a segment (no slash)
        re += "[^/]*";
        i += 1;
      }
    } else if ("+()^$.|{}[]".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  // If pattern has no '/', allow it to match a basename anywhere.
  let regex: RegExp;
  if (!p.includes("/")) {
    regex = new RegExp("(^|/)" + re + "$");
  } else {
    regex = new RegExp("^" + re + "$");
  }
  return regex.test(target);
}

/** Returns true if `path` matches any pattern in the multiline string. */
export function matchesAnyPattern(
  patterns: string,
  path: string,
): boolean {
  return patterns
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .some((p) => matchGlob(p, path));
}

/** Human-readable byte size. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Format a Date for log lines. */
export function nowStamp(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}