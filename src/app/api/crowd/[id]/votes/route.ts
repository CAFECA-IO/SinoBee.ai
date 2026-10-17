import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { castVote } from "@/lib/crowd/review";

/** A backer's acceptance vote (weighted by the shares they paid for) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { approve, reason } = z.object({ approve: z.boolean(), reason: z.string().max(2000).optional() }).parse(await req.json());
  await castVote(user.id, (await ctx.params).id, approve, reason);
  return json({ ok: true });
});
