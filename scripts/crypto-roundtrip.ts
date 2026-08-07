// Validates that the new WebCrypto + hash-wasm crypto implementation can
// decrypt blobs produced by the PREVIOUS Node-crypto implementation
// (scryptSync + createCipheriv), and that the new impl round-trips.
//
// Run: npx tsx scripts/crypto-roundtrip.ts
//
// src/crypto.ts reads `window.crypto` (Obsidian's own lint rule prefers
// `window` over `globalThis` for popout-window compatibility) — that global
// only exists in Electron's renderer, not plain Node, so this test-only shim
// points it at globalThis (which already has Web Crypto since Node 19+).
(globalThis as unknown as { window: typeof globalThis }).window ??= globalThis;
import { createCipheriv, scryptSync, randomBytes } from "crypto";
import { encryptSecrets, decryptSecrets } from "../src/crypto";
import type { Secrets, EncryptedBlob } from "../src/sync/types";

const PASS = "correct horse battery staple";
const SECRETS: Secrets = {
  email: "user@example.com",
  password: "p@ssw0rd",
  secondFactorCode: "123456",
  session: { key: "k", sid: "s", name: "n", user: "u" },
};

const PAYLOAD_MAGIC = "MEGA-SYNC-SECRETS-v1";
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** The PREVIOUS Node-crypto implementation, kept here as the oracle. */
function oldEncrypt(secrets: Secrets, passphrase: string): EncryptedBlob {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT_OPTS);
  const payload = Buffer.from(JSON.stringify({ __magic: PAYLOAD_MAGIC, ...secrets }), "utf8");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    cipher: enc.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: tag.toString("base64"),
  };
}

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

async function main(): Promise<void> {
  console.log("1) Old (Node-crypto) blob -> new (WebCrypto) decrypt");
  const oldBlob = oldEncrypt(SECRETS, PASS);
  const decoded = await decryptSecrets(oldBlob, PASS);
  check(decoded.email === SECRETS.email, "email matches");
  check(decoded.password === SECRETS.password, "password matches");
  check(decoded.secondFactorCode === SECRETS.secondFactorCode, "2FA matches");
  check(decoded.session?.key === SECRETS.session?.key, "session.key matches");
  check(decoded.session?.sid === SECRETS.session?.sid, "session.sid matches");

  console.log("2) New -> New round-trip");
  const newBlob = await encryptSecrets(SECRETS, PASS);
  const rt = await decryptSecrets(newBlob, PASS);
  check(rt.email === SECRETS.email, "email matches");
  check(rt.password === SECRETS.password, "password matches");
  check(rt.session?.sid === SECRETS.session?.sid, "session.sid matches");

  console.log("3) Wrong passphrase fails");
  try {
    await decryptSecrets(oldBlob, "wrong passphrase");
    check(false, "should have thrown on wrong passphrase (old blob)");
  } catch (e) {
    check(/wrong master passphrase|tampered/i.test(e instanceof Error ? e.message : String(e)), "threw friendly wrong-passphrase error (old blob)");
  }
  try {
    await decryptSecrets(newBlob, "wrong passphrase");
    check(false, "should have thrown on wrong passphrase (new blob)");
  } catch (e) {
    check(/wrong master passphrase|tampered/i.test(e instanceof Error ? e.message : String(e)), "threw friendly wrong-passphrase error (new blob)");
  }

  console.log("4) New blob format equals old format (keys + base64)");
  check(
    ["cipher", "iv", "salt", "tag"].every((k) => typeof newBlob[k as keyof EncryptedBlob] === "string"),
    "new blob has the same 4 base64 string fields",
  );

  if (failures === 0) {
    console.log("\nALL CRYPTO TESTS PASSED ✅");
    process.exit(0);
  } else {
    console.error(`\n${failures} TEST(S) FAILED ❌`);
    process.exit(1);
  }
}

void main();