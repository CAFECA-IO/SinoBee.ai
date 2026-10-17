import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { decideScreening } from "@/lib/crowd/screening";

/** Approve (open the campaign) or send a proposal back to its proposer */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { approve, note } = z.object({ approve: z.boolean(), note: z.string().max(2000).optional() }).parse(await req.json());
  await decideScreening(admin.id, (await ctx.params).id, approve, note);
  return json({ ok: true });
});
