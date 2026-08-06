// At-rest encryption for the MEGA secrets (email, password, 2FA, cached
// session) using AES-256-GCM with a key derived from a master passphrase via
// scrypt. Nothing leaves this module unencrypted; the passphrase is never
// persisted — it lives only in the plugin's memory for the current session.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { Secrets, EncryptedBlob, SessionCache } from "./sync/types";

const PAYLOAD_MAGIC = "MEGA-SYNC-SECRETS-v1";
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
}

/** Encrypt the secrets object. Returns a self-contained blob. */
export function encryptSecrets(secrets: Secrets, passphrase: string): EncryptedBlob {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const payload = Buffer.from(
    JSON.stringify({ __magic: PAYLOAD_MAGIC, ...secrets }),
    "utf8",
  );
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

/** Decrypt a blob. Throws a friendly error if the passphrase is wrong (the
 *  GCM auth tag will fail to verify). */
export function decryptSecrets(blob: EncryptedBlob, passphrase: string): Secrets {
  if (!blob || !blob.cipher || !blob.iv || !blob.salt || !blob.tag) {
    throw new Error("Encrypted secrets are missing or corrupted.");
  }
  const salt = Buffer.from(blob.salt, "base64");
  const iv = Buffer.from(blob.iv, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const data = Buffer.from(blob.cipher, "base64");
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    throw new Error("Wrong master passphrase, or the secrets were tampered with.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(plain.toString("utf8"));
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