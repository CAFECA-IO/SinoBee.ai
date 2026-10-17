import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { PledgeInput, pledge } from "@/lib/crowd/pledges";

/** Back a crowdfunded task with 1, 5 or 20 shares (card, points or subscription quota) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const p = await pledge(user.id, (await ctx.params).id, PledgeInput.parse(await req.json()));
  return json({ pledge: { id: p.id, status: p.status, amountTwd: p.amountTwd, shares: p.shares, source: p.source } });
});
