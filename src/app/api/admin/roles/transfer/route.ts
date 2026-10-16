import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { transferSuperAdmin } from "@/lib/roles";

/** Hand the super admin role to another user (the caller becomes ADMIN). `confirm` repeats the target account. */
export const POST = handle(async (req: Request) => {
  const actor = await requireSuperAdmin();
  const b = z.object({ userId: z.string(), confirm: z.string() }).parse(await req.json());
  const u = await transferSuperAdmin(actor, b.userId, b.confirm);
  return json({ ok: true, user: { id: u.id, account: u.account, role: u.role } });
});
