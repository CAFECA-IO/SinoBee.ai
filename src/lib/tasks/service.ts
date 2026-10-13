import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { HttpError } from "@/lib/errors";
import { modelById } from "@/lib/pricing";
import { notify } from "@/lib/notify";
import { addDays, resultsRetentionDays } from "@/lib/retention";
import { z } from "zod";

export const EVAL_METHODS = ["benchmark-suite", "rubric", "a-b-comparison"] as const;

export const TaskInput = z.object({
  kind: z.enum(["TASK", "EVALUATION"]).default("TASK"),
  title: z.string().trim().min(3).max(120),
  prompt: z.string().trim().min(10).max(20_000),
  model: z.string().refine((m) => !!modelById(m), "unsupported model"),
  skillVersionId: z.string().optional().nullable(),
  isPublic: z.boolean().default(false),
  budget: z.coerce.number().positive(),
  evalMethod: z.enum(EVAL_METHODS).optional(),
  evalCriteria: z.string().trim().max(10_000).optional(),
});

export async function createTask(userId: string, input: z.infer<typeof TaskInput>) {
  if (input.budget < config.payments.minTaskBudget) throw new HttpError(400, `minimum budget is ${config.payments.minTaskBudget} TWDC`);
  if (input.skillVersionId) {
    const sv = await db.skillVersion.findUnique({ where: { id: input.skillVersionId } });
    if (!sv || sv.status === "REVOKED" || sv.status === "REJECTED") throw new HttpError(400, "skill version not available");
  }
  if (input.kind === "EVALUATION" && !input.evalMethod) throw new HttpError(400, "evaluation method required");
  return db.task.create({
    data: {
      userId,
      kind: input.kind,
      title: input.title,
      prompt: input.prompt,
      model: input.model,
      skillVersionId: input.skillVersionId || null,
      // evaluation reports are always public
      isPublic: input.kind === "EVALUATION" ? true : input.isPublic,
      usdTwdRate: config.pricing.usdTwd,
      evalMethod: input.evalMethod ?? null,
      evalCriteria: input.evalCriteria ?? null,
    },
  });
}

/** User decision after the budget ran out: close the task with the partial results */
export async function closeTask(userId: string, taskId: string) {
  const t = await db.task.findUnique({ where: { id: taskId } });
  if (!t || t.userId !== userId) throw new HttpError(404, "task not found");
  if (!["NEEDS_FUNDING", "AWAITING_PAYMENT", "QUEUED"].includes(t.status)) throw new HttpError(400, "task cannot be closed in its current state");
  const days = await resultsRetentionDays(userId);
  const expires = addDays(new Date(), days);
  const status = t.status === "NEEDS_FUNDING" ? "COMPLETED" : "CANCELLED";
  await db.$transaction([
    db.task.update({ where: { id: t.id }, data: { status, finishedAt: t.finishedAt ?? new Date(), resultsExpireAt: expires, fundingRequestedAt: null } }),
    db.artifact.updateMany({ where: { taskId: t.id, deletedAt: null }, data: { expiresAt: expires } }),
    db.taskEvent.create({ data: { taskId: t.id, type: "closed", message: "Closed by the requester" } }),
  ]);
  if (status === "COMPLETED")
    await notify(userId, {
      type: "task.closed",
      title: `Task closed: ${t.title}`,
      body: `Download the results before ${expires.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
      link: `/tasks/${t.id}`,
    });
}

/** Can `viewerId` see this task? Owners always; others only if public */
export function canView(task: { userId: string; isPublic: boolean }, viewerId?: string | null) {
  return task.isPublic || task.userId === viewerId;
}
