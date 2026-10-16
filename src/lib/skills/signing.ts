import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { config } from "@/lib/config";

/**
 * Hub signatures: ed25519 over the ASCII content hash ("sha256:<hex>"), base64.
 * SinoBee pins the raw 32-byte public keys (base64) published at /.well-known/sinobee-hub-keys.json.
 */
let cached: { src: string; priv: KeyObject; pubRaw: string } | null = null;

/** The key is a setting (generated automatically, rotatable in /admin), so re-derive when it changes */
function keys() {
  const src = config.hub.signingKey;
  if (!src) return null;
  if (cached?.src === src) return cached;
  const priv = createPrivateKey({ key: Buffer.from(src, "base64"), format: "der", type: "pkcs8" });
  const spki = createPublicKey(priv).export({ format: "der", type: "spki" });
  // ed25519 SPKI DER = 12-byte header + 32-byte raw key
  return (cached = { src, priv, pubRaw: Buffer.from(spki.subarray(spki.length - 32)).toString("base64") });
}

/** Current key first, then earlier keys that existing signatures were made with */
export function hubPublicKeys(): string[] {
  const k = keys();
  return [...new Set([...(k ? [k.pubRaw] : []), ...config.hub.previousKeys])];
}

export function signContentHash(hash: string): string | null {
  const k = keys();
  if (!k) return null;
  return sign(null, Buffer.from(hash, "ascii"), k.priv).toString("base64");
}

export function verifyContentHash(hash: string, sigB64: string): boolean {
  const k = keys();
  if (!k) return false;
  return verify(null, Buffer.from(hash, "ascii"), createPublicKey(k.priv), Buffer.from(sigB64, "base64"));
}
