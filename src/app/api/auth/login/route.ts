import { createSession, readBind, upsertUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { consumeAndVerify } from "@/lib/signin-flow";
import type { SignInResponse } from "@/lib/cafeca";

/** popup / redirect mode: the browser hands the wallet response to us */
export const POST = handle(async (req: Request) => {
  const bind = await readBind();
  if (!bind) return json({ error: "missing browser binding" }, 400);
  const response = (await req.json()) as SignInResponse;
  const v = await consumeAndVerify(response, bind);
  const user = await upsertUser(v);
  await createSession(user.id, v.channel ? { id: v.channel.id, expiresAt: v.channel.expiresAt } : undefined);
  return json({ ok: true, user: { id: user.id, account: user.account, handle: user.handle, publisher: user.publisher } });
});
