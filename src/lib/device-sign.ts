import { createHash, createPublicKey, verify } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./errors";

/**
 * Signed device requests (plan v6 §7, P5).
 *
 * A SinoBee install that signs in with an Ed25519 key gets 15-minute access tokens and a device-bound refresh
 * token. Every request made with such a token carries:
 *
 *   X-SB-Timestamp  unix seconds (must be within ±60 s of the server clock)
 *   X-SB-Nonce      16–64 characters [A-Za-z0-9_-], never reused by the device
 *   X-SB-Signature  base64 Ed25519 signature of
 *                   METHOD "\n" PATH?QUERY "\n" TIMESTAMP "\n" NONCE "\n" hex(sha256(body))
 *
 * A stolen token is useless without the device's private key; a captured request cannot be replayed (nonce) or
 * delayed (timestamp) or altered (method, path and body hash are signed). Revoking the device stops it at once.
 */

export const SIG = { ts: "x-sb-timestamp", nonce: "x-sb-nonce", sig: "x-sb-signature" } as const;
export const SKEW_S = 60;
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

export function signingMessage(method: string, pathQuery: string, ts: string, nonce: string, bodySha256Hex: string) {
  return `${method.toUpperCase()}\n${pathQuery}\n${ts}\n${nonce}\n${bodySha256Hex}`;
}

export function isSigningKey(b64: string | null | undefined): boolean {
  return !!b64 && /^[A-Za-z0-9+/]{43}=$/.test(b64) && Buffer.from(b64, "base64").length === 32;
}

export function verifyEd25519(publicKeyB64: string, message: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(publicKeyB64, "base64")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** Check the signature headers of `req` for this device; throws 401 with a reason. Consumes the nonce. */
export async function verifySignedRequest(req: Request, device: { id: string; signingKey: string }, now = Date.now()) {
  const ts = req.headers.get(SIG.ts) ?? "";
  const nonce = req.headers.get(SIG.nonce) ?? "";
  const sig = req.headers.get(SIG.sig) ?? "";
  if (!ts || !nonce || !sig) throw new HttpError(401, "signed request required (X-SB-Timestamp, X-SB-Nonce, X-SB-Signature) — update SinoBee");
  if (!/^\d{9,11}$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > SKEW_S) throw new HttpError(401, "request timestamp is outside ±60 s — check the device clock");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) throw new HttpError(401, "invalid request nonce");
  if (req.bodyUsed) throw new HttpError(500, "request body read before the signature check");
  const body = Buffer.from(await req.clone().arrayBuffer());
  const u = new URL(req.url);
  const msg = signingMessage(req.method, u.pathname + u.search, ts, nonce, createHash("sha256").update(body).digest("hex"));
  if (!verifyEd25519(device.signingKey, msg, sig)) throw new HttpError(401, "invalid request signature");
  try {
    await db.requestNonce.create({ data: { deviceId: device.id, nonce } });
  } catch {
    throw new HttpError(401, "replayed request (nonce already used)");
  }
}

/** Nonces only matter inside the ±60 s window; keep 10 minutes and drop the rest */
export async function purgeNonces(now = new Date()) {
  const r = await db.requestNonce.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } } });
  return r.count;
}
