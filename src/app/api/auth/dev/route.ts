import { db } from "@/lib/db";
import { createSession, devLoginEnabled } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { applySignInRole, initialRole, isAdminRole } from "@/lib/roles";

/** Development-only login (DEV_LOGIN=1 and NODE_ENV!=production). Never enabled in production builds. */
export const POST = handle(async (req: Request) => {
  if (!devLoginEnabled()) return json({ error: "not found" }, 404);
  const { account = "0x000000000000000000000000000000000000dEaD", handle: h = "dev" } = (await req.json().catch(() => ({}))) as { account?: string; handle?: string };
  const acc = account.toLowerCase();
  const role = initialRole(acc);
  // same role rules as a real sign-in: OWNER_ACCOUNT bootstrap or the claim code, never an automatic admin
  const user = await applySignInRole(
    await db.user.upsert({
      where: { account: acc },
      create: { account: acc, handle: h, publisher: h, role, isAdmin: isAdminRole(role) },
      update: { lastLoginAt: new Date() },
    }),
  );
  await createSession(user.id);
  return json({ ok: true, user });
});
