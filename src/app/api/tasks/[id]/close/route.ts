import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { closeTask } from "@/lib/tasks/service";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await closeTask(user.id, (await ctx.params).id);
  return json({ ok: true });
});
