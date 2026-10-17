import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { rerunScreening } from "@/lib/crowd/screening";

/** Run the AI screening again for a proposal still waiting (the decision stays with the checklist) */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  await rerunScreening(admin.id, (await ctx.params).id);
  return json({ ok: true });
});
