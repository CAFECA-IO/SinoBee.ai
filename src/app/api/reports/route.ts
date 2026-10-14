import { z } from "zod";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadShare } from "@/lib/shares/service";

/** Report a public tool or a share */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { targetType, targetId, reason } = z
    .object({ targetType: z.enum(["tool", "share"]), targetId: z.string().min(1).max(64), reason: z.string().trim().min(3).max(2000) })
    .parse(await req.json());
  if (targetType === "share") {
    const { share, access } = await loadShare(targetId, user);
    if (!share || !access.ok) return json({ error: "not found" }, 404);
  } else {
    const t = await db.tool.findUnique({ where: { id: targetId } });
    if (!t || t.visibility !== "PUBLIC") return json({ error: "not found" }, 404);
  }
  if (!(await db.report.count({ where: { reporterId: user.id, targetType, targetId, resolvedAt: null } })))
    await db.report.create({ data: { reporterId: user.id, targetType, targetId, reason } });
  return json({ ok: true });
});
