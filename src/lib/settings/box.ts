import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dbTarget } from "../db-target";

/**
 * Encryption for secrets kept in the database (AES-256-GCM). The 32-byte key is generated on first use and kept
 * in data/secrets.key (mode 600) next to the SQLite file — or taken from SECRETS_KEY (base64/hex) when set, e.g.
 * on a PostgreSQL deployment with a secret manager. A copy of the database without the key reveals no secret.
 * Back the key file up separately: without it the stored secrets cannot be read.
 */

const PREFIX = "enc:v1:";
const g = globalThis as unknown as { __sbSecretKey?: Buffer };

export function keyFile() {
  const t = dbTarget();
  const dir = t.kind === "sqlite" ? path.dirname(t.file) : path.resolve(/*turbopackIgnore: true*/ process.cwd(), "data");
  return path.join(dir, "secrets.key");
}

function key(): Buffer {
  if (g.__sbSecretKey) return g.__sbSecretKey;
  const env = process.env.SECRETS_KEY?.trim();
  if (env) {
    const k = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, "hex") : Buffer.from(env, "base64");
    if (k.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes (64 hex characters or base64)");
    return (g.__sbSecretKey = k);
  }
  const f = keyFile();
  if (existsSync(f)) {
    const k = Buffer.from(readFileSync(f, "utf8").trim(), "base64");
    if (k.length !== 32) throw new Error(`${f} is not a 32-byte key`);
    return (g.__sbSecretKey = k);
  }
  mkdirSync(path.dirname(f), { recursive: true });
  const k = randomBytes(32);
  writeFileSync(f, k.toString("base64") + "\n", { mode: 0o600, flag: "wx" });
  try {
    chmodSync(f, 0o600);
  } catch {
    /* best effort */
  }
  console.log(`created ${f} — it encrypts the secrets stored in the database; back it up separately`);
  return (g.__sbSecretKey = k);
}

/** A MAC key for one purpose, derived from the secrets key (so it survives restarts and is shared by every instance) */
export function macKey(purpose: string): Buffer {
  return createHmac("sha256", key()).update(`sinobee.ai/${purpose}`).digest();
}

export const isSealed = (v: string) => v.startsWith(PREFIX);

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function open(sealed: string): string {
  if (!isSealed(sealed)) return sealed;
  const b = Buffer.from(sealed.slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

/** Short fingerprint of the key (shown in /admin so a restored backup can be matched to its key) */
export const keyFingerprint = () => createHash("sha256").update(key()).digest("hex").slice(0, 12);
