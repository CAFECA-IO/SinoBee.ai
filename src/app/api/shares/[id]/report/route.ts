import { z } from "zod";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadShare } from "@/lib/shares/service";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const id = (await ctx.params).id;
  const { reason } = z.object({ reason: z.string().trim().min(3).max(2000) }).parse(await req.json());
  const { share, access } = await loadShare(id, user);
  if (!share || !access.ok) return json({ error: "not found" }, 404);
  if (await db.report.count({ where: { reporterId: user.id, targetType: "share", targetId: id, resolvedAt: null } })) return json({ ok: true });
  await db.report.create({ data: { reporterId: user.id, targetType: "share", targetId: id, reason } });
  return json({ ok: true });
});
