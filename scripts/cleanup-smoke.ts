// Sanity-checks the conflict-copy name parsing used by cleanup.ts (the regex
// and the legacy-timestamp reconstruction), against the names the engine
// actually writes: legacy wall-clock stamps (`2026-10-30T12-34-56-789Z`, with
// `:` and `.` replaced by `-`) and the current content-hash tags (12 hex chars).
// Run: npx tsx scripts/cleanup-smoke.ts

// Mirrors src/sync/cleanup.ts (kept in sync manually — cleanup.ts imports
// obsidian, so it can't be loaded under plain node).
const CONFLICT_RE = /^(.*)\.conflict-([0-9a-f]{12}|\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d+)?Z?)(.*)$/;

function parseTs(tag: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d+))?Z?$/.exec(tag);
  if (!m) return 0;
  const frac = m[5] ? "." + m[5] : "";
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}${frac}Z`;
  const t = Date.parse(iso);
  return isNaN(t) ? 0 : t;
}

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

console.log("1) Legacy wall-clock conflict names match and parse");
{
  // The engine writes `<base-without-ext>.conflict-<tag><ext>` (see engine.ts
  // resolveConflict), so `notes.md` becomes `notes.conflict-<tag>.md`.
  const name = "notes.conflict-2026-10-30T12-34-56-789Z.md";
  const m = CONFLICT_RE.exec(name);
  check(!!m, "matches the legacy name");
  if (m) {
    check(m[1] + m[3] === "notes.md", "base path reconstructed (notes.md)");
    const ts = parseTs(m[2]);
    check(ts === Date.parse("2026-10-30T12:34:56.789Z"), "fractional-seconds stamp parses to the right epoch ms");
  }
}

console.log("2) Legacy names without fractional seconds");
{
  const name = "a/b/page.conflict-2026-10-30T12-34-56Z.md";
  const m = CONFLICT_RE.exec(name);
  check(!!m, "matches");
  if (m) {
    check(m[1] + m[3] === "a/b/page.md", "nested base path reconstructed");
    check(parseTs(m[2]) === Date.parse("2026-10-30T12:34:56Z"), "whole-second stamp parses");
  }
}

console.log("3) Content-hash conflict names match, parse to 0 (no time)");
{
  const name = "notes.conflict-3a9f0c11de22.md";
  const m = CONFLICT_RE.exec(name);
  check(!!m, "matches the hash-based name");
  if (m) {
    check(m[1] + m[3] === "notes.md", "base path reconstructed");
    check(m[2] === "3a9f0c11de22", "hash tag captured");
    check(parseTs(m[2]) === 0, "hash tag has no timestamp (falls back to inventory mtime)");
  }
}

console.log("4) Non-conflict files are NOT matched");
{
  for (const name of ["notes.md", "notes.conflict.md", "notes.md.bak", "conflict-2026-10-30T12-34-56Z.md"]) {
    check(!CONFLICT_RE.exec(name), `"${name}" is not a conflict copy`);
  }
}

console.log("5) Extension-less conflict name");
{
  const name = "LICENSE.conflict-2026-10-30T12-34-56Z";
  const m = CONFLICT_RE.exec(name);
  check(!!m, "matches a name with no trailing extension");
  if (m) check(m[1] === "LICENSE" && m[3] === "", "base is LICENSE, no extension");
}

if (failures === 0) {
  console.log("\nALL CLEANUP-PARSING TESTS PASSED ✅");
  process.exit(0);
} else {
  console.error(`\n${failures} TEST(S) FAILED ❌`);
  process.exit(1);
}
