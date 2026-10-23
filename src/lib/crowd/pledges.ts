import { z } from "zod";
import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { cleanBuyer, type Buyer } from "../payments";
import { BuyerInput } from "../buyer-schema";
import { quotaContext } from "../llm/quota";
import type { Prisma } from "@/generated/prisma/client";
import { latestCard, usableCard } from "./cards";
import { bookPoints, pointBalance, spendPoints } from "./points";
import { SHARE_OPTIONS, sharePrice } from "./rules";

/**
 * Pledges. A backer picks 1, 5 or 20 shares and pays with:
 *  CARD    a saved card; nothing is charged until the goal is reached (then one charge per backer and task); with
 *          usePoints the backer's points pay first and the card only the rest (all points → a POINTS pledge)
 *  POINTS  platform points, deducted now and given back if the campaign fails
 *  QUOTA   (legacy) subscription quota. New quota pledges are no longer taken (2026-10-23); the ones already made
 *          are still collected, settled and given back as quota (returnQuota)
 * After funding (start-early campaigns that stay open, or a task that ran out of budget) card pledges are charged
 * at once and every pledge adds to the budget immediately.
 */

export const PledgeInput = z.object({
  shares: z.coerce.number().int().refine((n) => (SHARE_OPTIONS as readonly number[]).includes(n), "shares must be 1, 5 or 20"),
  source: z.enum(["CARD", "POINTS"], { message: "pay with a card or platform points" }),
  /** needed for CARD pledges: the e-invoice goes to this buyer when the card is charged */
  buyer: BuyerInput.optional(),
  /**
   * CARD: spend platform points first (the pledge pages always do): the card is charged only what the points do not
   * cover, and when they cover everything the pledge becomes a POINTS pledge (no card needed)
   */
  usePoints: z.boolean().default(false),
  /** CARD: the saved card to charge (the newest card of the current mode when omitted) */
  cardId: z.string().max(40).optional(),
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

export type PledgeArgs = Omit<z.infer<typeof PledgeInput>, "usePoints"> & { usePoints?: boolean };

export async function pledge(userId: string, taskId: string, input: PledgeArgs) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !task.crowdfund || (!task.isPublic && task.userId !== userId)) throw new HttpError(404, "task not found");
  // a self-funded task is paid by its proposer alone (they may still add a top-up)
  if (task.selfFunded && task.userId !== userId) throw new HttpError(400, "this task is paid in full by its proposer");
  if (!(OPEN as readonly string[]).includes(task.status)) throw new HttpError(400, "this task is not taking pledges");
  if (task.status === "FUNDING" && task.deadlineAt && task.deadlineAt <= new Date()) throw new HttpError(400, "crowdfunding has ended");
  if (!(SHARE_OPTIONS as readonly number[]).includes(input.shares)) throw new HttpError(400, "shares must be 1, 5 or 20");
  if (input.source !== "CARD" && input.source !== "POINTS") throw new HttpError(400, "pay with a card or platform points");
  if (config.crowd.pledgeMinKyc > 0) {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { kycLevel: true } });
    if ((u.kycLevel ?? 0) < config.crowd.pledgeMinKyc) throw new HttpError(403, `pledging needs CAFECA KYC level ${config.crowd.pledgeMinKyc} or higher`);
  }
  const amount = input.shares * sharePrice();
  let cardId: string | null = null;
  let pointsTwd = 0;
  // a top-up round is open: the pledge waits for the round's goal like a campaign pledge
  const topup = task.status === "NEEDS_FUNDING" && !!task.topupGoalTwd;

  let source = input.source;
  if (source === "CARD" && input.usePoints) {
    const balance = await pointBalance(userId);
    if (balance >= amount) source = "POINTS";
    else pointsTwd = Math.max(0, balance);
  }

  if (source === "CARD") {
    const card = input.cardId ? await usableCard(userId, input.cardId) : await latestCard(userId);
    if (!card) throw new HttpError(400, "save a card first");
    cardId = card.id;
    if (!input.buyer) throw new HttpError(400, "buyer name and email are required for the e-invoice");
    await db.user.update({ where: { id: userId }, data: { billing: cleanBuyer(input.buyer as Buyer) as Prisma.InputJsonValue } });
  }

  const { currentChecklist } = await import("./checklist");
  const termsVersion = (await currentChecklist()).version;
  const p = await db.pledge.create({ data: { taskId, userId, source, shares: input.shares, amountTwd: amount, cardId, pointsTwd, topup, termsVersion } });
  if (source === "POINTS" || pointsTwd > 0) {
    try {
      await spendPoints(userId, source === "POINTS" ? amount : pointsTwd, `pledge:${p.id}`, taskId);
    } catch (e) {
      await db.pledge.delete({ where: { id: p.id } });
      throw e;
    }
  }
  await db.taskEvent.create({ data: { taskId, type: "pledge", message: `${input.shares} share(s) pledged (${amount} TWD, ${source.toLowerCase()}${pointsTwd ? ` + ${pointsTwd} points` : ""})`, data: { pledge: p.id } } });
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
  if (!ctx.subscriptionId) return false; // the subscription ended: the quota lapses
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
