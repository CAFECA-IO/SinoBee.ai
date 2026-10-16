import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { setRole } from "@/lib/roles";

/** Grant (ADMIN) or revoke (USER) admin rights — super admin only */
export const POST = handle(async (req: Request) => {
  const actor = await requireSuperAdmin();
  const b = z.object({ userId: z.string(), role: z.enum(["ADMIN", "USER"]) }).parse(await req.json());
  const u = await setRole(actor, b.userId, b.role);
  return json({ ok: true, user: { id: u.id, account: u.account, role: u.role } });
});
