import { db } from "@/lib/db";
import { createSession, readBind } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import type { SignInResponse } from "@/lib/cafeca";

export const GET = handle(async (req: Request) => {
  const nonce = new URL(req.url).searchParams.get("nonce") ?? "";
  const bind = await readBind();
  const n = await db.authNonce.findUnique({ where: { nonce } });
  if (!n || !bind || n.bind !== bind) return json({ error: "unknown" }, 404);
  if (n.error) return json({ error: n.error });
  if (!n.userId || !n.response) return json({ pending: true });
  // hand over exactly once
  const r = await db.authNonce.deleteMany({ where: { nonce, userId: n.userId } });
  if (r.count !== 1) return json({ error: "already used" }, 409);
  const resp = n.response as unknown as SignInResponse;
  await createSession(n.userId, resp.channel ? { id: resp.channel.id, expiresAt: resp.channel.expiresAt } : undefined);
  return json({ ok: true, response: resp });
});
