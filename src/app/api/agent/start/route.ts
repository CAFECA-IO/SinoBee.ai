import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { ensurePersonalAgent, enterUrl } from "@/lib/agent/personal";

/** 線上使用: start the signed-in user's own SinoBee container and return the gateway URL that opens it */
export const POST = handle(async () => {
  const user = await requireUser();
  await ensurePersonalAgent(user.id);
  return json({ url: enterUrl(user.id) });
});
