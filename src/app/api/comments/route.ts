import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { canView } from "@/lib/tasks/service";
import { notify } from "@/lib/notify";

const Input = z.object({
  targetType: z.enum(["SKILL", "TASK", "EVALUATION"]),
  targetId: z.string().min(1),
  parentId: z.string().optional().nullable(),
  body: z.string().trim().min(1).max(5000),
  /** crowdfunded tasks: "reference" marks information for the agent (proposer and backers only) */
  kind: z.enum(["comment", "reference"]).default("comment"),
});

async function targetOwner(type: "SKILL" | "TASK" | "EVALUATION", id: string, viewer: string) {
  if (type === "SKILL") {
    const s = await db.skill.findUnique({ where: { id }, include: { publisher: true } });
    return s ? { owner: s.publisherId, link: `/skills/${s.publisher.publisher}/${s.name}`, title: s.name } : null;
  }
  if (type === "TASK") {
    const t = await db.task.findUnique({ where: { id } });
    return t && canView(t, viewer) ? { owner: t.userId, link: `/tasks/${t.id}`, title: t.title } : null;
  }
  const r = await db.evaluationReport.findUnique({ where: { id }, include: { task: true } });
  return r && r.task.status === "COMPLETED" ? { owner: r.requesterId, link: `/benchmarks/reports/${r.id}`, title: r.task.title } : null;
}

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const b = Input.parse(await req.json());
  const target = await targetOwner(b.targetType, b.targetId, user.id);
  if (!target) return json({ error: "not found" }, 404);
  if (b.kind === "reference") {
    const t = b.targetType === "TASK" ? await db.task.findUnique({ where: { id: b.targetId } }) : null;
    const backer = t ? t.userId === user.id || (await db.pledge.count({ where: { taskId: t.id, userId: user.id, status: { in: ["ACTIVE", "CHARGED"] } } })) > 0 : false;
    if (!t?.crowdfund || !backer) return json({ error: "only the proposer and backers can add reference information" }, 403);
  }
  if (b.parentId) {
    const p = await db.comment.findUnique({ where: { id: b.parentId } });
    if (!p || p.targetId !== b.targetId || p.targetType !== b.targetType) return json({ error: "bad parent" }, 400);
  }
  const c = await db.comment.create({ data: { ...b, parentId: b.parentId ?? null, userId: user.id } });
  if (target.owner !== user.id)
    await notify(target.owner, { type: "comment", title: `New comment on ${target.title}`, body: b.body.slice(0, 300), link: target.link });
  return json({ id: c.id });
});

/** soft delete own comment (admins: any) */
export const DELETE = handle(async (req: Request) => {
  const user = await requireUser();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const c = await db.comment.findUnique({ where: { id } });
  if (!c || (c.userId !== user.id && !user.isAdmin)) return json({ error: "not found" }, 404);
  await db.comment.update({ where: { id }, data: { deletedAt: new Date(), body: "" } });
  return json({ ok: true });
});
