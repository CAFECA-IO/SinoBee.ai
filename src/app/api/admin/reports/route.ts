import { z } from "zod";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { revokeShare } from "@/lib/shares/service";
import { notify } from "@/lib/notify";

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
  await db.report.update({ where: { id: reportId }, data: { resolvedAt: new Date() } });
  return json({ ok: true });
});
