import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { json } from "@/lib/http";
import { currentUser } from "@/lib/auth";
import { dbAvailable, dbOutage, isDbDown, noteDbDown } from "@/lib/db-health";
import { ROLE_HINT_COOKIE, isAdminHint, roleHintValue } from "@/lib/role-hint";

export const dynamic = "force-dynamic";

/**
 * Public site flags the browser needs: test mode ribbon and database status. While the database is down, admins
 * (signed role hint cookie) also get the error code and connection target; visitors only learn that it is down.
 */
export async function GET() {
  const jar = await cookies();
  let dbOk = await dbAvailable();
  let hint: { value: string; expires: Date } | null | undefined; // undefined = leave the cookie as it is
  if (dbOk) {
    try {
      const u = await currentUser();
      hint = u ? roleHintValue(u.id, u.role) : null;
    } catch (e) {
      if (!isDbDown(e)) throw e;
      noteDbDown(e);
      dbOk = false;
    }
  }
  const admin = dbOk ? false : isAdminHint(jar.get(ROLE_HINT_COOKIE)?.value);
  const res = json(
    { testMode: config.testMode, db: dbOk ? { ok: true } : { ok: false, ...(admin ? { admin: true, ...dbOutage() } : {}) } },
    { headers: { "cache-control": "no-store" } },
  );
  if (hint) res.cookies.set(ROLE_HINT_COOKIE, hint.value, { httpOnly: true, sameSite: "lax", secure: config.origin.startsWith("https://"), path: "/", expires: hint.expires });
  else if (hint === null && jar.get(ROLE_HINT_COOKIE)) res.cookies.delete(ROLE_HINT_COOKIE);
  return res;
}
