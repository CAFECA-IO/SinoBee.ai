import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { canView } from "@/lib/tasks/service";

/** Rate a result good (+1) / bad (-1); 0 removes the vote */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { value } = z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }).parse(await req.json());
  const t = await db.task.findUnique({ where: { id } });
  if (!t || !canView(t, user.id)) return json({ error: "not found" }, 404);
  if (!["COMPLETED", "FAILED", "NEEDS_FUNDING"].includes(t.status)) return json({ error: "nothing to rate yet" }, 400);
  if (value === 0) await db.taskVote.deleteMany({ where: { taskId: id, userId: user.id } });
  else await db.taskVote.upsert({ where: { taskId_userId: { taskId: id, userId: user.id } }, create: { taskId: id, userId: user.id, value }, update: { value } });
  const [up, down] = await Promise.all([db.taskVote.count({ where: { taskId: id, value: 1 } }), db.taskVote.count({ where: { taskId: id, value: -1 } })]);
  return json({ up, down, mine: value });
});
