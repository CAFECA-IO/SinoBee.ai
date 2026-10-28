import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { HttpError } from "@/lib/errors";
import { isAdminRole } from "@/lib/roles";
import { handle, json } from "@/lib/http";
import { ensurePersonalAgent, enterUrl } from "@/lib/agent/personal";

/** 線上使用: start the signed-in user's own SinoBee container and return the gateway URL that opens it */
export const POST = handle(async () => {
  const user = await requireUser();
  // switched off in /admin → Settings → Site: admins only
  if (!config.agentOnline && !isAdminRole(user.role)) throw new HttpError(403, "agent_offline");
  await ensurePersonalAgent(user.id);
  return json({ url: enterUrl(user.id) });
});
