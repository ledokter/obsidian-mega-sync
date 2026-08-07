// Automatic three-way text merge for conflicting notes, so two independent
// edits to different parts of the same file don't need a "keep both copies"
// duplicate — only genuinely overlapping edits still fall back to that.
//
// The plugin's snapshot only tracks {path, mtime, size}, not file content, so
// there's no stored common ancestor to diff against. Instead we reconstruct
// one: the longest common subsequence (line-by-line) of the two divergent
// texts stands in for the original they both diverged from. This is the same
// trick other Obsidian sync tools' "smart merge" features use.
import { LCS, merge, ILCSResult } from "node-diff3";

const MERGEABLE_EXT = new Set(["md", "markdown", "txt"]);
/** Above this size, skip merging (and keep both copies instead) — line-by-
 *  line diffing a huge file is slow and a "conflict" there is less likely to
 *  be two harmless edits to different sections. */
const MERGEABLE_MAX_BYTES = 2 * 1024 * 1024;

export function isMergeableText(path: string, sizeBytes: number): boolean {
  if (sizeBytes > MERGEABLE_MAX_BYTES) return false;
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = path.slice(dot + 1).toLowerCase();
  return MERGEABLE_EXT.has(ext);
}

function lcsText(a: string, b: string): string {
  const aa = a.split("\n");
  const bb = b.split("\n");
  let node: ILCSResult | null = LCS(aa, bb);
  const out: string[] = [];
  while (node && node.buffer1index !== -1) {
    out.unshift(aa[node.buffer1index]);
    node = node.chain;
  }
  return out.join("\n");
}

export interface MergeAttempt {
  merged: string;
  /** True only if every changed region was non-overlapping and could be
   *  resolved without guessing. The caller should fall back to keeping both
   *  copies when false. */
  clean: boolean;
}

export function attemptTextMerge(local: string, remote: string): MergeAttempt {
  if (local === remote) return { merged: local, clean: true };
  const ancestor = lcsText(local, remote);
  const res = merge(local, ancestor, remote, { stringSeparator: "\n" });
  return { merged: res.result.join("\n"), clean: !res.conflict };
}
