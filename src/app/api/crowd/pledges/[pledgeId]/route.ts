import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { cancelPledge } from "@/lib/crowd/pledges";

/** Withdraw a pledge while the campaign is open */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ pledgeId: string }> }) => {
  const user = await requireUser();
  await cancelPledge(user.id, (await ctx.params).pledgeId);
  return json({ ok: true });
});
