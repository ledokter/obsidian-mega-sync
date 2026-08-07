// At-rest encryption for the MEGA secrets (email, password, 2FA, cached
// session) using AES-256-GCM with a key derived from a master passphrase via
// scrypt. Nothing leaves this module unencrypted; the passphrase is never
// persisted — it lives only in the plugin's memory for the current session.
//
// Implementation uses the Web Crypto API (crypto.subtle) for AES-256-GCM and
// hash-wasm (WASM scrypt) for key derivation, so it runs on both desktop
// (Electron) and mobile (browser webview) without Node's `crypto` module.
//
// Blob format is unchanged from the previous Node-crypto implementation
// ({cipher, iv, salt, tag} as base64), and the scrypt parameters are the same
// (N=16384, r=8, p=1, dkLen=32), so secrets encrypted by the previous version
// remain decryptable — scrypt is a standard algorithm and hash-wasm produces
// the same key as Node's scryptSync for identical inputs.
import { scrypt } from "hash-wasm";
import { Secrets, EncryptedBlob, SessionCache } from "./sync/types";

const PAYLOAD_MAGIC = "MEGA-SYNC-SECRETS-v1";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DK_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const GCM_TAG_LEN = 16;

function assertSubtle(): SubtleCrypto {
  const s = window.crypto?.subtle;
  if (!s) {
    throw new Error(
      "Web Crypto (crypto.subtle) is not available in this context. " +
        "Disable at-rest encryption to store secrets in plaintext, or run the plugin in a secure context.",
    );
  }
  return s;
}

/** Derive a 32-byte AES key from the passphrase + salt via scrypt. */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  return scrypt({
    password: passphrase,
    salt,
    costFactor: SCRYPT_N,
    blockSize: SCRYPT_R,
    parallelism: SCRYPT_P,
    hashLength: DK_LEN,
    outputType: "binary",
  });
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(b64: string): Uint8Array {
  return Buffer.from(b64, "base64");
}

/** Encrypt the secrets object. Returns a self-contained blob. */
export async function encryptSecrets(secrets: Secrets, passphrase: string): Promise<EncryptedBlob> {
  const subtle = assertSubtle();
  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, salt);
  const payload = Buffer.from(
    JSON.stringify({ __magic: PAYLOAD_MAGIC, ...secrets }),
    "utf8",
  );
  const cryptoKey = await subtle.importKey("raw", key as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  // WebCrypto AES-GCM returns ciphertext + 16-byte auth tag appended.
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, payload));
  const cipher = sealed.slice(0, sealed.length - GCM_TAG_LEN);
  const tag = sealed.slice(sealed.length - GCM_TAG_LEN);
  return {
    cipher: toBase64(cipher),
    iv: toBase64(iv),
    salt: toBase64(salt),
    tag: toBase64(tag),
  };
}

/** Decrypt a blob. Throws a friendly error if the passphrase is wrong (the
 *  GCM auth tag will fail to verify). */
export async function decryptSecrets(blob: EncryptedBlob, passphrase: string): Promise<Secrets> {
  if (!blob || !blob.cipher || !blob.iv || !blob.salt || !blob.tag) {
    throw new Error("Encrypted secrets are missing or corrupted.");
  }
  const subtle = assertSubtle();
  const salt = fromBase64(blob.salt);
  const iv = fromBase64(blob.iv);
  const tag = fromBase64(blob.tag);
  const cipher = fromBase64(blob.cipher);
  const key = await deriveKey(passphrase, salt);
  const cryptoKey = await subtle.importKey("raw", key as BufferSource, { name: "AES-GCM" }, false, ["decrypt"]);
  // Reassemble ciphertext + tag as WebCrypto expects.
  const sealed = new Uint8Array(cipher.length + tag.length);
  sealed.set(cipher, 0);
  sealed.set(tag, cipher.length);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, cryptoKey, sealed));
  } catch {
    throw new Error("Wrong master passphrase, or the secrets were tampered with.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(plain).toString("utf8"));
  } catch {
    throw new Error("Decrypted secrets payload is not valid JSON.");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Decrypted secrets payload is not an object.");
  }
  const obj = raw as Record<string, unknown>;
  if (obj["__magic"] !== PAYLOAD_MAGIC) {
    throw new Error("Secrets payload magic mismatch — refusing to load.");
  }
  return {
    email: typeof obj["email"] === "string" ? obj["email"] : "",
    password: typeof obj["password"] === "string" ? obj["password"] : "",
    secondFactorCode: typeof obj["secondFactorCode"] === "string" ? obj["secondFactorCode"] : "",
    session: isSessionCache(obj["session"]) ? obj["session"] : null,
  };
}

/** Runtime check for a cached session object. */
function isSessionCache(v: unknown): v is SessionCache {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o["key"] === "string" && typeof o["sid"] === "string";
}