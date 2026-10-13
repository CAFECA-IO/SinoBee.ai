import { db } from "@/lib/db";
import { upsertUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { consumeAndVerify } from "@/lib/signin-flow";
import type { SignInResponse } from "@/lib/cafeca";

/**
 * post mode (cross-device QR): the wallet on the user's phone POSTs here directly (no cookies).
 * The result is parked on the nonce until the desktop browser that owns it polls /api/auth/poll.
 */
export const POST = handle(async (req: Request) => {
  const raw = (await req.json()) as SignInResponse & { error?: string; nonce?: string };
  if (raw.error) {
    if (raw.nonce) await db.authNonce.updateMany({ where: { nonce: raw.nonce, used: false }, data: { used: true, error: String(raw.error).slice(0, 64) } });
    return json({ ok: true });
  }
  const v = await consumeAndVerify(raw); // bind checked when the browser polls
  const user = await upsertUser(v);
  await db.authNonce.update({ where: { nonce: raw.message.nonce }, data: { userId: user.id, response: JSON.parse(JSON.stringify(raw)) } });
  return json({ ok: true });
});
