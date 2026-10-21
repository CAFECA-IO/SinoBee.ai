import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { setDisabled } from "@/lib/admin/users";

/** Disable (with a reason) or re-enable an account */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const b = z.object({ disabled: z.boolean(), reason: z.string().trim().max(500).optional() }).parse(await req.json());
  const u = await setDisabled(admin, (await ctx.params).id, b.disabled, b.reason);
  return json({ ok: true, disabled: !!u.disabledAt });
});
