// Best-effort Screen Wake Lock for the (potentially long) first sync.
// `navigator.wakeLock` is typed as always-present in lib.dom, but is in fact
// absent on unsupported browsers/webviews — checked at runtime, and any
// failure (unsupported, refused, page not visible) silently does nothing:
// the FirstSyncModal instructions are the reliable fallback on those devices.

export interface WakeLockHandle {
  release: () => void;
}

/** Request a screen wake lock, if the platform supports it. Returns null
 *  (never throws) when unsupported or refused — e.g. the app isn't the
 *  foreground/visible document, which is common right after a mobile
 *  permission prompt. */
export async function requestWakeLock(): Promise<WakeLockHandle | null> {
  if (!("wakeLock" in navigator)) return null;
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    return { release: () => { void sentinel.release(); } };
  } catch {
    return null;
  }
}
