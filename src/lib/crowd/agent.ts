import { db } from "../db";
import { notify } from "../notify";

/**
 * The SinoBee agent reports a crowdfunded task's progress as comments (kind "status") under the task, written by a
 * system account, and notifies the proposer and every backer for the milestones that matter.
 */

export const AGENT_ACCOUNT = "system:sinobee-agent";

let agentId: string | null = null;

export async function agentUserId(): Promise<string> {
  if (agentId) {
    // the cached id may belong to a database a test replaced
    const still = await db.user.findUnique({ where: { id: agentId }, select: { id: true } });
    if (still) return agentId;
  }
  const u = await db.user.upsert({
    where: { account: AGENT_ACCOUNT },
    create: { account: AGENT_ACCOUNT, handle: "SinoBee Agent", displayName: "SinoBee Agent" },
    update: {},
  });
  return (agentId = u.id);
}

/** People who should hear about a crowdfunded task: the proposer and backers with live pledges */
export async function audience(taskId: string): Promise<string[]> {
  const t = await db.task.findUnique({ where: { id: taskId }, select: { userId: true } });
  // everyone who pledged and did not withdraw (released / refunded backers still hear how it ended)
  const backers = await db.pledge.findMany({ where: { taskId, status: { not: "CANCELLED" } }, select: { userId: true }, distinct: ["userId"] });
  return [...new Set([...(t ? [t.userId] : []), ...backers.map((b) => b.userId)])];
}

/** Post a status comment; with `notifyTitle` also notify the audience */
export async function postStatus(taskId: string, body: string, opts: { notifyTitle?: string; type?: string } = {}) {
  const userId = await agentUserId();
  const c = await db.comment.create({ data: { targetType: "TASK", targetId: taskId, userId, body: body.slice(0, 5000), kind: "status" } });
  if (opts.notifyTitle) {
    const task = await db.task.findUnique({ where: { id: taskId }, select: { title: true } });
    for (const uid of await audience(taskId)) {
      await notify(uid, { type: opts.type ?? "crowd.status", title: `${opts.notifyTitle}: ${task?.title ?? ""}`, body: body.slice(0, 600), link: `/tasks/${taskId}` }).catch(() => undefined);
    }
  }
  return c;
}

/** Worker task events that become status comments (the ones marked notify also reach the audience) */
const MIRRORED: Record<string, { notify?: string }> = {
  "run.started": { notify: "開始執行 Started" },
  progress: {},
  "budget.50": {},
  "budget.80": {},
  "funding.requested": { notify: "需要追加經費 Needs more funds" },
  completed: { notify: "任務完成 Completed" },
  failed: { notify: "任務失敗 Failed" },
  closed: { notify: "任務結案 Closed" },
};

/** Called for every task event; only crowdfunded tasks and the types above are mirrored */
export async function mirrorEvent(taskId: string, type: string, message: string) {
  const m = MIRRORED[type];
  if (!m) return;
  const t = await db.task.findUnique({ where: { id: taskId }, select: { crowdfund: true } });
  if (!t?.crowdfund) return;
  await postStatus(taskId, message, { notifyTitle: m.notify, type: `crowd.${type}` }).catch((e) => console.warn("agent comment", (e as Error).message));
}
