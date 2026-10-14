import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config";

/**
 * Each stored object is sealed for its own X25519 key pair. The private key is kept only here,
 * encrypted (AES-256-GCM) with the site master key and bound to the object key (AAD).
 * Deleting the wrapped key makes every on-chain copy permanently unreadable (crypto-shredding).
 */
function master(): Buffer {
  const raw = config.boltchain.masterKey.trim();
  const k = /^(0x)?[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw.replace(/^0x/, ""), "hex") : Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("BOLT_MASTER_KEY must be 32 bytes (64 hex chars or base64)");
  return k;
}

export function wrapKey(secret: Uint8Array, objectKey: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", master(), iv);
  c.setAAD(Buffer.from(`sinobee/object-key/v1\0${objectKey}`));
  const ct = Buffer.concat([c.update(secret), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, ct, c.getAuthTag()]).toString("base64");
}

export function unwrapKey(wrapped: string, objectKey: string): Uint8Array {
  const b = Buffer.from(wrapped, "base64");
  if (b[0] !== 1 || b.length < 1 + 12 + 16) throw new Error("bad wrapped key");
  const d = createDecipheriv("aes-256-gcm", master(), b.subarray(1, 13));
  d.setAAD(Buffer.from(`sinobee/object-key/v1\0${objectKey}`));
  d.setAuthTag(b.subarray(b.length - 16));
  return new Uint8Array(Buffer.concat([d.update(b.subarray(13, b.length - 16)), d.final()]));
}
