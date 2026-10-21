import { db } from "../db";
import { HEALTHY_MARGIN, planMargin } from "../price-math";
import type { PlanView } from "../plans";

/**
 * How a plan earns, for /admin → 訂閱方案.
 *
 * Margin is fee ÷ vendor cost. Published prices are vendor cost × buffer, so a subscriber who spends U (published TWD)
 * in 30 days costs U ÷ buffer, and margin = fee × buffer ÷ U.
 *   - basis "actual": U = the average 30-day spend of the plan's subscription periods (each period's settled usage,
 *     scaled to 30 days by how long it has run; periods that ran < MIN_DAYS are left out as too short to say)
 *   - basis "full": no such period yet, so U = the plan's whole allowance (fee × multiplier) and margin = buffer ÷
 *     multiplier, the worst case
 * The free plan has no fee: its line is the average vendor cost per user who used it in the last 30 days.
 */

const DAY = 86400_000;
/** periods shorter than this do not say much about a month */
export const MIN_DAYS = 3;
/** look back this far for subscription periods */
export const LOOKBACK_DAYS = 120;

export type PlanEconomics = {
  planId: string;
  basis: "actual" | "full";
  /** periods (paid plans) or users (free plan) behind an "actual" figure */
  sample: number;
  /** average 30-day spend at published prices, TWD */
  avgUseTwd: number;
  /** avgUse ÷ allowance */
  utilization: number;
  /** vendor cost of that spend, TWD */
  costTwd: number;
  /** fee ÷ cost (Infinity when nothing was used); null for the free plan */
  margin: number | null;
  /** the worst case: buffer ÷ multiplier */
  fullMargin: number | null;
};

export type MarginLevel = "loss" | "thin" | "healthy";
export const marginLevel = (m: number): MarginLevel => (m < 1 ? "loss" : m < HEALTHY_MARGIN ? "thin" : "healthy");

/** Spend of each subscription period, scaled to 30 days */
export async function periodSpend(planId: string, now = new Date()) {
  const subs = await db.subscription.findMany({
    where: { planId, cancelledAt: null, startsAt: { lte: now, gte: new Date(now.getTime() - LOOKBACK_DAYS * DAY) } },
    select: { id: true, userId: true, startsAt: true, endsAt: true },
  });
  const long = subs
    .map((s) => ({ ...s, days: (Math.min(now.getTime(), s.endsAt.getTime()) - s.startsAt.getTime()) / DAY }))
    .filter((s) => s.days >= MIN_DAYS);
  if (!long.length) return [];
  const spent = await db.usageLedger.groupBy({
    by: ["subscriptionId"],
    where: { subscriptionId: { in: long.map((s) => s.id) }, billing: "subscription", status: { not: "HELD" } },
    _sum: { settledTwd: true },
  });
  const by = new Map(spent.map((r) => [r.subscriptionId, Number(r._sum.settledTwd ?? 0)]));
  return long.map((s) => {
    const twd = by.get(s.id) ?? 0;
    return { subscriptionId: s.id, userId: s.userId, days: s.days, spentTwd: twd, per30Twd: (twd * 30) / Math.min(s.days, 30) };
  });
}

export async function planEconomics(plan: PlanView, buffer: number, now = new Date()): Promise<PlanEconomics> {
  if (plan.feeTwd <= 0) {
    // the free plan: average 30-day spend of the users who used it
    const since = new Date(now.getTime() - 30 * DAY);
    const rows = await db.usageLedger.groupBy({
      by: ["userId"],
      where: { planId: plan.id, billing: "subscription", status: { not: "HELD" }, settledAt: { gte: since } },
      _sum: { settledTwd: true },
    });
    const users = rows.length;
    const avg = users ? rows.reduce((a, r) => a + Number(r._sum.settledTwd ?? 0), 0) / users : plan.maxCostTwd;
    return {
      planId: plan.id, basis: users ? "actual" : "full", sample: users, avgUseTwd: round(avg),
      utilization: plan.maxCostTwd > 0 ? avg / plan.maxCostTwd : 0, costTwd: round(buffer > 0 ? avg / buffer : 0), margin: null, fullMargin: null,
    };
  }
  const periods = await periodSpend(plan.id, now);
  const full = planMargin(plan.multiplier, buffer);
  if (!periods.length) {
    return {
      planId: plan.id, basis: "full", sample: 0, avgUseTwd: plan.maxCostTwd, utilization: 1,
      costTwd: round(buffer > 0 ? plan.maxCostTwd / buffer : 0), margin: full, fullMargin: full,
    };
  }
  // a period cannot use more than the allowance, whatever the scaling says
  const avg = periods.reduce((a, p) => a + Math.min(p.per30Twd, plan.maxCostTwd), 0) / periods.length;
  const cost = buffer > 0 ? avg / buffer : 0;
  return {
    planId: plan.id, basis: "actual", sample: periods.length, avgUseTwd: round(avg),
    utilization: plan.maxCostTwd > 0 ? avg / plan.maxCostTwd : 0, costTwd: round(cost),
    margin: cost > 0 ? plan.feeTwd / cost : Infinity, fullMargin: full,
  };
}

export type Suggestion =
  | { kind: "multiplier"; value: number; margin: number; maxCostTwd: number }
  | { kind: "fee"; value: number; margin: number }
  | { kind: "buffer"; value: number; margin: number };

/**
 * Ways to bring a plan to break-even and to the healthy margin. On the worst case the multiplier and the buffer decide
 * the margin; on actual use only the fee does.
 */
export function suggestions(plan: PlanView, e: PlanEconomics, buffer: number): Suggestion[] {
  if (e.margin === null || !(e.margin < HEALTHY_MARGIN)) return [];
  const out: Suggestion[] = [];
  if (e.basis === "full") {
    for (const m of [HEALTHY_MARGIN, 1]) {
      const mult = floor2(buffer / m);
      if (mult > 0 && mult < plan.multiplier) out.push({ kind: "multiplier", value: mult, margin: m, maxCostTwd: round(plan.feeTwd * mult) });
    }
    out.push({ kind: "buffer", value: ceil2(plan.multiplier * HEALTHY_MARGIN), margin: HEALTHY_MARGIN });
  } else {
    // the vendor cost of what subscribers actually use does not move with the buffer (a higher buffer only makes the
    // same tokens use more of the allowance), so on actual use the fee is the lever
    out.push({ kind: "fee", value: Math.ceil((e.costTwd * HEALTHY_MARGIN) / 10) * 10, margin: HEALTHY_MARGIN });
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
const floor2 = (n: number) => Math.floor(n * 100) / 100;
const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
