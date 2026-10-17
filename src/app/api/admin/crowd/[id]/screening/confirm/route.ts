import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { confirmScreening } from "@/lib/crowd/screening";

/** Confirm the AI's screening result; the proposer is told at once (opens / starts, or back to draft) */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  return json(await confirmScreening(admin.id, (await ctx.params).id));
});
