import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { OpenInput, openFunding } from "@/lib/crowd/proposal";

/** Open the campaign for pledges */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const t = await openFunding(user.id, (await ctx.params).id, OpenInput.parse(await req.json()));
  return json({ task: { id: t.id, status: t.status, goalTwd: t.goalTwd, deadlineAt: t.deadlineAt } });
});
