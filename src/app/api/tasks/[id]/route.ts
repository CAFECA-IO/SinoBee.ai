import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { canView } from "@/lib/tasks/service";

/** Lightweight status endpoint polled by the task page */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const u = await currentUser();
  const t = await db.task.findUnique({ where: { id } });
  if (!t || !canView(t, u?.id)) return json({ error: "not found" }, 404);
  return json({
    status: t.status,
    charged: t.charged.toString(),
    budget: t.budget.toString(),
    updatedAt: t.updatedAt,
  });
});
