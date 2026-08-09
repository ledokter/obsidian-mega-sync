// Content-hash change detection, layered on top of the mtime+size heuristic
// (see engine.ts `changed()`). Only computed at transfer time, when the file
// bytes are already in memory for an upload/download — no extra I/O.
import { blake3 } from "hash-wasm";

/** Files above this size are not hashed (avoids CPU cost on large media on
 *  low-end/mobile devices); the mtime+size heuristic still applies to them. */
const HASH_MAX_BYTES = 25 * 1024 * 1024;

/** Hash a buffer's content (BLAKE3, hex). Returns undefined for buffers over
 *  the size cap, or when `enabled` is false. */
export async function hashContent(buf: ArrayBuffer, enabled: boolean): Promise<string | undefined> {
  if (!enabled || buf.byteLength > HASH_MAX_BYTES) return undefined;
  return blake3(new Uint8Array(buf));
}
