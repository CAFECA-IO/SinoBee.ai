import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { HttpError } from "@/lib/errors";
import { notify } from "@/lib/notify";
import { addDays, resultsRetentionDays } from "@/lib/retention";

export { EVAL_METHODS } from "@/lib/crowd/rules";

/**
 * The proposer drops a draft proposal (CANCELLED) or, when the budget ran out (NEEDS_FUNDING), closes the task with
 * the results so far (COMPLETED, settled for the backers).
 */
export async function closeTask(userId: string, taskId: string) {
  const t = await db.task.findUnique({ where: { id: taskId } });
  if (!t || t.userId !== userId) throw new HttpError(404, "task not found");
  // backers paid for it, so only a drafted proposal can be dropped or an unfunded run closed
  if (!t.crowdfund || !["DRAFT", "NEEDS_FUNDING"].includes(t.status)) throw new HttpError(400, "task cannot be closed in its current state");
  const days = Math.max(config.crowd.resultsDays, await resultsRetentionDays(userId));
  const expires = addDays(new Date(), days);
  const status = t.status === "NEEDS_FUNDING" ? "COMPLETED" : "CANCELLED";
  await db.$transaction([
    db.task.update({ where: { id: t.id }, data: { status, finishedAt: t.finishedAt ?? new Date(), resultsExpireAt: expires, fundingRequestedAt: null } }),
    db.artifact.updateMany({ where: { taskId: t.id, deletedAt: null }, data: { expiresAt: expires } }),
    db.taskEvent.create({ data: { taskId: t.id, type: "closed", message: "Closed by the requester" } }),
  ]);
  if (status === "COMPLETED") {
    // a top-up round still open: its pledges are given back first
    const { releasePledge } = await import("@/lib/crowd/pledges");
    for (const p of await db.pledge.findMany({ where: { taskId: t.id, topup: true, status: { in: ["ACTIVE", "FAILED"] } } })) await releasePledge(p.id, "RELEASED");
    if (t.topupGoalTwd) await db.task.update({ where: { id: t.id }, data: { topupGoalTwd: null, topupDeadlineAt: null } });
    const { mirrorEvent } = await import("@/lib/crowd/agent");
    const { settleTask } = await import("@/lib/crowd/lifecycle");
    await mirrorEvent(t.id, "closed", "發起人以目前成果結案。The proposer closed the task with the results so far.");
    await settleTask(t.id);
  }
  if (status === "COMPLETED")
    await notify(userId, {
      type: "task.closed",
      title: `Task closed: ${t.title}`,
      body: `Download the results before ${expires.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
      link: `/tasks/${t.id}`,
    });
}

/** Can `viewerId` see this task? Owners always; others only if public (crowdfunding drafts only the proposer) */
export function canView(task: { userId: string; isPublic: boolean; status?: string }, viewerId?: string | null) {
  if (task.userId === viewerId) return true;
  return task.isPublic && task.status !== "DRAFT";
}

/** May `viewerId` download the results? The requester, and for crowdfunded tasks every backer whose pledge was collected */
export async function canDownload(task: { id: string; userId: string; crowdfund: boolean }, viewerId?: string | null) {
  if (!viewerId) return false;
  if (task.userId === viewerId) return true;
  if (!task.crowdfund) return false;
  return (await db.pledge.count({ where: { taskId: task.id, userId: viewerId, status: "CHARGED" } })) > 0;
}
