import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { notify } from "../notify";
import { addDays } from "../retention";
import { audit } from "../roles";
import type { Prisma, Task } from "@/generated/prisma/client";
import { postStatus } from "./agent";
import { normalizeAcceptance, sharePrice, type Acceptance } from "./rules";

/**
 * Acceptance of a crowdfunded result.
 *
 *  1. The run completes → IN_REVIEW. The agent's self-check (outputs/acceptance.json, one entry per acceptance
 *     criterion) is shown to everyone; backers can download the results and vote for crowd.reviewDays days.
 *  2. Votes are weighted by the shares each backer paid for. The result is accepted when approving shares are at
 *     least crowd.approveShare of the shares that voted (no votes = accepted). The vote closes early once every
 *     backer has voted.
 *  3. Accepted → COMPLETED and the leftover is settled. Rejected → a rework run with the backers' reasons while
 *     budget and crowd.maxReworks allow, otherwise DISPUTED until an admin decides: accept (normal settlement) or
 *     refund (the whole budget, spent part included, goes back to the backers as points; the platform bears it).
 */

async function event(taskId: string, type: string, message: string, data?: object) {
  await db.taskEvent.create({ data: { taskId, type, message, data: data ?? undefined } });
}

/** The worker hands a finished crowdfunded run over to the backers */
export async function enterReview(taskId: string, raw: unknown) {
  const acceptance = normalizeAcceptance(raw);
  const now = new Date();
  await db.task.update({
    where: { id: taskId },
    data: { status: "IN_REVIEW", acceptance: (acceptance ?? undefined) as Prisma.InputJsonValue | undefined, reviewDeadlineAt: addDays(now, config.crowd.reviewDays), reworkNotes: null, workerId: null, finishedAt: now },
  });
  const passed = acceptance?.criteria.filter((c) => c.passed).length ?? 0;
  const total = acceptance?.criteria.length ?? 0;
  await event(taskId, "review.opened", `Acceptance review opened (${passed}/${total} criteria self-checked as passed)`);
  await postStatus(
    taskId,
    `執行完成，請出資者在 ${config.crowd.reviewDays} 天內驗收（Agent 自檢 ${passed}/${total} 項通過）。The run is finished: backers, please review it within ${config.crowd.reviewDays} days (self-check ${passed}/${total} passed).`,
    { notifyTitle: "請驗收 Please review", type: "crowd.review" },
  );
}

/** Shares a backer paid for (collected pledges) */
export async function paidShares(taskId: string, userId: string) {
  const r = await db.pledge.aggregate({ where: { taskId, userId, status: "CHARGED" }, _sum: { shares: true } });
  return r._sum.shares ?? 0;
}

export async function castVote(userId: string, taskId: string, approve: boolean, reason?: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task?.crowdfund || task.status !== "IN_REVIEW") throw new HttpError(400, "this task is not in review");
  const shares = await paidShares(taskId, userId);
  if (!shares) throw new HttpError(403, "only backers whose pledge was collected can vote");
  const text = reason?.trim().slice(0, 2000) || null;
  if (!approve && !text) throw new HttpError(400, "tell the agent what is missing (a reason is required to reject)");
  const key = { taskId_userId_round: { taskId, userId, round: task.reworks } };
  await db.acceptanceVote.upsert({ where: key, create: { taskId, userId, round: task.reworks, approve, reason: text, shares }, update: { approve, reason: text, shares } });
  await maybeCloseEarly(task);
}

export async function tally(taskId: string, round: number) {
  const votes = await db.acceptanceVote.findMany({ where: { taskId, round } });
  const yes = votes.filter((v) => v.approve).reduce((a, v) => a + v.shares, 0);
  const no = votes.filter((v) => !v.approve).reduce((a, v) => a + v.shares, 0);
  return { yes, no, voters: votes.length, votes };
}

async function maybeCloseEarly(task: Task) {
  const backers = await db.pledge.findMany({ where: { taskId: task.id, status: "CHARGED" }, select: { userId: true }, distinct: ["userId"] });
  const t = await tally(task.id, task.reworks);
  if (backers.length > 0 && t.voters >= backers.length) await closeReview(task.id, new Date());
}

/** Decide the review (deadline passed or everyone voted) */
export async function closeReview(taskId: string, now = new Date()) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (task.status !== "IN_REVIEW") return;
  const t = await tally(taskId, task.reworks);
  const accepted = t.yes + t.no === 0 || t.yes >= (t.yes + t.no) * config.crowd.approveShare;
  if (accepted) {
    const r = await db.task.updateMany({ where: { id: taskId, status: "IN_REVIEW" }, data: { status: "COMPLETED", finishedAt: now } });
    if (r.count !== 1) return;
    await event(taskId, "review.accepted", `Accepted (${t.yes} approving / ${t.no} rejecting shares)`, { yes: t.yes, no: t.no });
    await postStatus(taskId, `驗收通過（贊成 ${t.yes} 份 / 反對 ${t.no} 份）。Accepted (${t.yes} / ${t.no} shares).`, { notifyTitle: "驗收通過 Accepted", type: "crowd.accepted" });
    const { settleTask } = await import("./lifecycle");
    await settleTask(taskId);
    return;
  }
  const notes = t.votes
    .filter((v) => !v.approve && v.reason)
    .map((v) => `- (${v.shares} share${v.shares > 1 ? "s" : ""}) ${v.reason}`)
    .join("\n")
    .slice(0, 8000);
  const left = Number(task.budget) - Number(task.charged);
  const canRework = task.reworks < config.crowd.maxReworks && left >= sharePrice();
  if (canRework) {
    const r = await db.task.updateMany({ where: { id: taskId, status: "IN_REVIEW" }, data: { status: "QUEUED", reworks: { increment: 1 }, reworkNotes: notes, reviewDeadlineAt: null, finishedAt: null } });
    if (r.count !== 1) return;
    await event(taskId, "review.rework", `Rejected (${t.yes} / ${t.no} shares): rework ${task.reworks + 1} queued`, { yes: t.yes, no: t.no });
    await postStatus(taskId, `驗收未通過（贊成 ${t.yes} 份 / 反對 ${t.no} 份），Agent 會依出資者的意見重做。Rejected (${t.yes} / ${t.no} shares): the agent reworks it with the backers' feedback.\n\n${notes}`, { notifyTitle: "驗收未通過，重做中 Rework", type: "crowd.rework" });
    return;
  }
  const r = await db.task.updateMany({ where: { id: taskId, status: "IN_REVIEW" }, data: { status: "DISPUTED", reworkNotes: notes } });
  if (r.count !== 1) return;
  await event(taskId, "review.disputed", `Rejected (${t.yes} / ${t.no} shares) with no rework left: waiting for the platform`, { yes: t.yes, no: t.no });
  await postStatus(taskId, `驗收未通過且無法再重做，已交由平台仲裁。Rejected with no rework left; the platform will decide.`, { notifyTitle: "驗收爭議 Disputed", type: "crowd.disputed" });
  const admins = await db.user.findMany({ where: { role: { in: ["ADMIN", "SUPERADMIN"] } }, select: { id: true } });
  for (const a of admins) await notify(a.id, { type: "crowd.disputed", title: `眾籌驗收爭議 Dispute: ${task.title}`, body: notes.slice(0, 600), link: `/tasks/${taskId}` }).catch(() => undefined);
}

/** Admin decision on a disputed task */
export async function resolveDispute(actorId: string, taskId: string, decision: "accept" | "refund", note?: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.status !== "DISPUTED") throw new HttpError(400, "this task is not disputed");
  const status = decision === "accept" ? "COMPLETED" : "FAILED";
  const r = await db.task.updateMany({ where: { id: taskId, status: "DISPUTED" }, data: { status, finishedAt: new Date(), ...(decision === "refund" ? { error: `Refunded by the platform: ${note ?? ""}`.slice(0, 2000) } : {}) } });
  if (r.count !== 1) return;
  await audit(actorId, "crowd.dispute", { type: "task", id: taskId }, { decision, note: note ?? null });
  await event(taskId, "review.resolved", `Platform decision: ${decision}${note ? ` — ${note}` : ""}`);
  await postStatus(
    taskId,
    decision === "accept"
      ? `平台仲裁：成果符合規格，視為驗收通過。Platform decision: the result meets the spec.${note ? `\n${note}` : ""}`
      : `平台仲裁：成果不符規格，全部經費（含已使用部分）依出資比例轉為平台點數。Platform decision: the result does not meet the spec; the whole budget goes back to the backers as points.${note ? `\n${note}` : ""}`,
    { notifyTitle: "仲裁結果 Decision", type: "crowd.resolved" },
  );
  const { settleTask } = await import("./lifecycle");
  await settleTask(taskId, { full: decision === "refund" });
}

/** Reviews whose vote period ended */
export async function reviewTick(now = new Date()) {
  const due = await db.task.findMany({ where: { status: "IN_REVIEW", reviewDeadlineAt: { lte: now } }, select: { id: true }, take: 50 });
  for (const t of due) await closeReview(t.id, now);
  return due.length;
}

export type { Acceptance };
