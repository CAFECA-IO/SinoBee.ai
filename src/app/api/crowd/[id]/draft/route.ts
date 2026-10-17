import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { DraftUpdate, updateDraft } from "@/lib/crowd/proposal";

/** Rename or recategorise a draft */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const t = await updateDraft(user.id, (await ctx.params).id, DraftUpdate.parse(await req.json()));
  return json({ title: t.title, category: t.category });
});
