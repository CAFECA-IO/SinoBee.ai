import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { resolveDispute } from "@/lib/crowd/review";

/** Platform decision on a disputed crowdfunded task */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { decision, note } = z.object({ decision: z.enum(["accept", "refund"]), note: z.string().max(2000).optional() }).parse(await req.json());
  await resolveDispute(admin.id, (await ctx.params).id, decision, note);
  return json({ ok: true });
});
