import { cookies } from "next/headers";
import { config } from "./config";
import { currentUser } from "./auth";
import { isAdminRole } from "./roles";
import { isDbDown } from "./db-health";
import { ROLE_HINT_COOKIE, isAdminHint } from "./role-hint";

/**
 * 線上使用 is switched on and off in /admin → Settings → Site (site.agentOnline, off by default). While it is off,
 * visitors see "Coming soon" and the start API refuses them; admins keep full access so they can test it.
 */
export type AgentAccess = { online: boolean; admin: boolean; allowed: boolean };

/** Is the viewer an admin? Falls back to the signed role hint while the database is unreachable. */
async function viewerIsAdmin(): Promise<boolean> {
  try {
    const u = await currentUser();
    return !!u && isAdminRole(u.role);
  } catch (e) {
    if (!isDbDown(e)) throw e;
    return isAdminHint((await cookies()).get(ROLE_HINT_COOKIE)?.value);
  }
}

export async function agentAccess(): Promise<AgentAccess> {
  const online = config.agentOnline;
  // only look the viewer up when it matters (keeps the home page cheap while the feature is open)
  const admin = online ? false : await viewerIsAdmin();
  return { online, admin, allowed: online || admin };
}
