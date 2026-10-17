import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { generateSpec } from "@/lib/crowd/spec-agent";

/** The model drafts the whole proposal from the description (once, after the proposal fee is paid) */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  return json(await generateSpec(user.id, (await ctx.params).id));
});
