import { z } from "zod";
import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { cleanBuyer, type Buyer } from "../payments";
import { BuyerInput } from "../buyer-schema";
import { headroom, quotaContext } from "../llm/quota";
import type { Prisma } from "@/generated/prisma/client";
import { latestCard } from "./cards";
import { bookPoints, pointBalance, spendPoints } from "./points";
import { SHARE_OPTIONS, sharePrice } from "./rules";

/**
 * Pledges. A backer picks 1, 5 or 20 shares and pays with:
 *  CARD    a saved card; nothing is charged until the goal is reached (then one charge per backer and task)
 *  POINTS  platform points, deducted now and given back if the campaign fails
 *  QUOTA   subscription quota (published-price TWD), deducted now inside the 6 h / 168 h windows, given back as
 *          quota only (never cash or points); capped per period and per task
 * After funding (start-early campaigns that stay open, or a task that ran out of budget) card pledges are charged
 * at once and every pledge adds to the budget immediately.
 */

export const PledgeInput = z.object({
  shares: z.coerce.number().int().refine((n) => (SHARE_OPTIONS as readonly number[]).includes(n), "shares must be 1, 5 or 20"),
  source: z.enum(["CARD", "POINTS", "QUOTA"]),
  /** needed for CARD pledges: the e-invoice goes to this buyer when the card is charged */
  buyer: BuyerInput.optional(),
  /** CARD: pay part with points (the card is charged the rest, at least 1 TWD) */
  usePoints: z.boolean().default(false),
});

/** Tasks that accept pledges, and whether a pledge is collected right away */
const OPEN = ["FUNDING", "CHARGING", "QUEUED", "RUNNING", "NEEDS_FUNDING"] as const;
export const collectsNow = (status: string) => status !== "FUNDING";

/** Totals for the crowdfunding panel */
export async function pledgeTotals(taskId: string) {
  const rows = await db.pledge.groupBy({ by: ["status"], where: { taskId }, _sum: { amountTwd: true } });
  const sum = (...st: string[]) => rows.filter((r) => st.includes(r.status)).reduce((a, r) => a + (r._sum.amountTwd ?? 0), 0);
  const backers = await db.pledge.findMany({ where: { taskId, status: { in: ["ACTIVE", "CHARGED", "FAILED"] } }, select: { userId: true }, distinct: ["userId"] });
  return { pledged: sum("ACTIVE", "CHARGED", "FAILED"), collected: sum("CHARGED") + (await collectedNonCard(taskId)), backers: backers.length };
}

/** Points and quota pledges are collected when made */
async function collectedNonCard(taskId: string) {
  const r = await db.pledge.aggregate({ where: { taskId, status: "ACTIVE", source: { in: ["POINTS", "QUOTA"] } }, _sum: { amountTwd: true } });
  return r._sum.amountTwd ?? 0;
}

async function quotaPledge(userId: string, taskId: string, amount: number, goal: number) {
  const ctx = await quotaContext(userId);
  const room = await headroom(ctx);
  if (room.free < amount) throw new HttpError(429, `not enough subscription quota right now (${Math.floor(room.free)} TWD free in the current window)`);
  // per period: quota pledges (net of returns) ≤ share × the plan's usage allowance
  const period = await db.usageLedger.aggregate({ where: { userId, subscriptionId: ctx.subscriptionId, endpoint: { in: ["crowd-pledge", "crowd-return"] } }, _sum: { settledTwd: true } });
  const periodCap = ctx.plan.maxCostTwd * config.crowd.quotaPeriodShare;
  if (Number(period._sum.settledTwd ?? 0) + amount > periodCap + 1e-6) throw new HttpError(400, `quota pledges are limited to ${Math.floor(periodCap)} TWD per subscription period`);
  // per task: quota pledges ≤ share × goal
  const onTask = await db.pledge.aggregate({ where: { taskId, source: "QUOTA", status: { in: ["ACTIVE", "CHARGED"] } }, _sum: { amountTwd: true } });
  const taskCap = goal * config.crowd.quotaTaskShare;
  if ((onTask._sum.amountTwd ?? 0) + amount > taskCap + 1e-6) throw new HttpError(400, `quota can cover at most ${Math.floor(taskCap)} TWD of this task's goal`);
  const now = new Date();
  const row = await db.usageLedger.create({
    data: { userId, subscriptionId: ctx.subscriptionId, planId: ctx.plan.id, modelId: "crowd", endpoint: "crowd-pledge", status: "SETTLED", heldTwd: amount, settledTwd: amount, priceTwd: {}, settledAt: now },
  });
  return row.id;
}

export type PledgeArgs = Omit<z.infer<typeof PledgeInput>, "usePoints"> & { usePoints?: boolean };

export async function pledge(userId: string, taskId: string, input: PledgeArgs) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !task.crowdfund || !task.isPublic) throw new HttpError(404, "task not found");
  if (!(OPEN as readonly string[]).includes(task.status)) throw new HttpError(400, "this task is not taking pledges");
  if (task.status === "FUNDING" && task.deadlineAt && task.deadlineAt <= new Date()) throw new HttpError(400, "crowdfunding has ended");
  if (!(SHARE_OPTIONS as readonly number[]).includes(input.shares)) throw new HttpError(400, "shares must be 1, 5 or 20");
  if (config.crowd.pledgeMinKyc > 0) {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { kycLevel: true } });
    if ((u.kycLevel ?? 0) < config.crowd.pledgeMinKyc) throw new HttpError(403, `pledging needs CAFECA KYC level ${config.crowd.pledgeMinKyc} or higher`);
  }
  const amount = input.shares * sharePrice();
  let cardId: string | null = null;
  let usageLedgerId: string | null = null;
  let pointsTwd = 0;
  // a top-up round is open: the pledge waits for the round's goal like a campaign pledge
  const topup = task.status === "NEEDS_FUNDING" && !!task.topupGoalTwd;

  if (input.source === "CARD") {
    const card = await latestCard(userId);
    if (!card) throw new HttpError(400, "save a card first");
    cardId = card.id;
    if (!input.buyer) throw new HttpError(400, "buyer name and email are required for the e-invoice");
    await db.user.update({ where: { id: userId }, data: { billing: cleanBuyer(input.buyer as Buyer) as Prisma.InputJsonValue } });
    if (input.usePoints) pointsTwd = Math.max(0, Math.min(await pointBalance(userId), amount - 1));
  } else if (input.source === "QUOTA") {
    usageLedgerId = await quotaPledge(userId, taskId, amount, task.goalTwd ?? amount);
  }

  const p = await db.pledge.create({ data: { taskId, userId, source: input.source, shares: input.shares, amountTwd: amount, cardId, usageLedgerId, pointsTwd, topup } });
  if (input.source === "POINTS" || pointsTwd > 0) {
    try {
      await spendPoints(userId, input.source === "POINTS" ? amount : pointsTwd, `pledge:${p.id}`, taskId);
    } catch (e) {
      await db.pledge.delete({ where: { id: p.id } });
      throw e;
    }
  }
  await db.taskEvent.create({ data: { taskId, type: "pledge", message: `${input.shares} share(s) pledged (${amount} TWD, ${input.source.toLowerCase()})`, data: { pledge: p.id } } });
  if (topup || collectsNow(task.status)) {
    const { collectLate } = await import("./lifecycle");
    await collectLate(taskId, p.id);
  } else {
    const { maybeStartEarly } = await import("./lifecycle");
    await maybeStartEarly(taskId);
  }
  return db.pledge.findUniqueOrThrow({ where: { id: p.id } });
}

/** Give back what a pledge took before it was used (points / quota); card pledges were never charged */
export async function releasePledge(pledgeId: string, status: "CANCELLED" | "RELEASED") {
  const p = await db.pledge.findUniqueOrThrow({ where: { id: pledgeId } });
  const r = await db.pledge.updateMany({ where: { id: pledgeId, status: { in: ["ACTIVE", "FAILED"] } }, data: { status } });
  if (r.count !== 1) return false;
  if (p.source === "POINTS") await bookPoints({ userId: p.userId, delta: p.amountTwd, reason: "release", ref: `release:${p.id}`, taskId: p.taskId });
  if (p.source === "CARD" && p.pointsTwd > 0) await bookPoints({ userId: p.userId, delta: p.pointsTwd, reason: "release", ref: `release:${p.id}`, taskId: p.taskId });
  if (p.source === "QUOTA") await returnQuota(p.userId, p.amountTwd, p.id);
  return true;
}

/**
 * Quota goes back to the backer's current subscription period as a negative usage row (it frees room in the
 * windows). Without a current subscription the quota lapses, as quota does.
 */
export async function returnQuota(userId: string, amount: number, pledgeId: string) {
  if (!(amount > 0)) return false;
  let ctx;
  try {
    ctx = await quotaContext(userId);
  } catch {
    return false;
  }
  const now = new Date();
  await db.usageLedger.create({
    data: { userId, subscriptionId: ctx.subscriptionId, planId: ctx.plan.id, modelId: "crowd", endpoint: "crowd-return", status: "SETTLED", heldTwd: 0, settledTwd: -amount, priceTwd: { pledge: pledgeId }, settledAt: now },
  });
  return true;
}

/** A backer withdraws a pledge while the campaign is still open (before any charge) */
export async function cancelPledge(userId: string, pledgeId: string) {
  const p = await db.pledge.findUnique({ where: { id: pledgeId }, include: { task: true } });
  if (!p || p.userId !== userId) throw new HttpError(404, "pledge not found");
  const openRound = p.task.status === "FUNDING" || (p.topup && p.task.status === "NEEDS_FUNDING" && !!p.task.topupGoalTwd);
  if (!openRound || p.status !== "ACTIVE") throw new HttpError(400, "only pledges of an open campaign can be withdrawn");
  await releasePledge(p.id, "CANCELLED");
  await db.taskEvent.create({ data: { taskId: p.taskId, type: "pledge.cancelled", message: `${p.shares} share(s) withdrawn` } });
}
