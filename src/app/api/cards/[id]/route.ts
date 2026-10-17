import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { removeCard } from "@/lib/crowd/cards";

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await removeCard(user.id, (await ctx.params).id);
  return json({ ok: true });
});
