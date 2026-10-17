import { z } from "zod";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { revokeShare } from "@/lib/shares/service";
import { takedownTool } from "@/lib/tools/service";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/roles";

/** Resolve a report: take the share down (crypto-shred) or dismiss */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const { reportId, takedown } = z.object({ reportId: z.string(), takedown: z.boolean() }).parse(await req.json());
  const r = await db.report.findUnique({ where: { id: reportId } });
  if (!r) return json({ error: "not found" }, 404);
  if (takedown && r.targetType === "share") {
    const s = await revokeShare(r.targetId, admin, "takedown");
    await notify(s.ownerId, { type: "share.takedown", title: `Your share “${s.title}” was taken down`, body: r.reason, link: "/account#shares" }).catch(() => undefined);
  }
  if (takedown && r.targetType === "tool") {
    const t = await takedownTool(r.targetId);
    await notify(t.ownerId, { type: "tool.takedown", title: `Your tool ${t.name} was removed from the directory`, body: r.reason, link: "/account#tools" }).catch(() => undefined);
  }
  if (takedown && r.targetType === "task") {
    const { takedownCrowd } = await import("@/lib/crowd/lifecycle");
    await takedownCrowd(r.targetId, r.reason);
    const t = await db.task.findUnique({ where: { id: r.targetId }, select: { userId: true, title: true } });
    if (t) await notify(t.userId, { type: "crowd.takedown", title: `你的眾籌已被下架 Taken down: ${t.title}`, body: r.reason, link: `/tasks/${r.targetId}` }).catch(() => undefined);
  }
  await db.report.updateMany({ where: { targetType: r.targetType, targetId: r.targetId, resolvedAt: null }, data: { resolvedAt: new Date() } });
  await audit(admin.id, takedown ? "report.takedown" : "report.dismiss", { type: r.targetType, id: r.targetId }, { reportId: r.id });
  return json({ ok: true });
});
