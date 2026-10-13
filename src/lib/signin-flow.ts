import { db } from "./db";
import { config } from "./config";
import { cafeca, type SignInResponse, type VerifiedSignIn } from "./cafeca";
import { HttpError } from "./errors";

/**
 * Invalidate the nonce first (single use, even on failure), then verify the wallet's response
 * (domain, nonce, chain, expiry, ERC-1271 isValidSignature on the user's identity contract).
 */
export async function consumeAndVerify(response: SignInResponse, bind?: string): Promise<VerifiedSignIn> {
  const nonce = response?.message?.nonce;
  if (typeof nonce !== "string") throw new HttpError(400, "invalid response");
  const where = { nonce, used: false, expiresAt: { gt: new Date() }, ...(bind ? { bind } : {}) };
  const r = await db.authNonce.updateMany({ where, data: { used: true } });
  if (r.count !== 1) throw new HttpError(400, "nonce invalid, used or not issued to this browser");
  try {
    return await cafeca.verify(response, { domain: config.origin, nonce });
  } catch (e) {
    throw new HttpError(401, e instanceof Error ? e.message : "verification failed");
  }
}
