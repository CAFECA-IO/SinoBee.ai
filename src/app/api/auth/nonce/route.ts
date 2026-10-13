import { db } from "@/lib/db";
import { getOrSetBind } from "@/lib/auth";
import { newNonce } from "@/lib/cafeca";
import { handle, json } from "@/lib/http";

export const POST = handle(async () => {
  const bind = await getOrSetBind();
  const nonce = newNonce();
  await db.authNonce.create({ data: { nonce, bind, expiresAt: new Date(Date.now() + 5 * 60_000) } });
  // housekeeping
  await db.authNonce.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 3600_000) } } });
  return json({ nonce });
});
