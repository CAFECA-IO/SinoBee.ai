import { db } from "./db";
import { config } from "./config";
import { HttpError } from "./errors";
import { addDays } from "./retention";

/**
 * Subscription periods: 30 days each, no auto-renewal. Buying again (any plan) stacks a new period after the last
 * one. Results and the container are kept while subscribed and for `graceDays` (30) after the last period ends.
 * A refunded period is cancelled and the periods after it move up (reflow).
 */

const DAY = 86400_000;

export type SubState = {
  /** period covering now */
  current: { id: string; plan: string; planId: string | null; startsAt: Date; endsAt: Date } | null;
  /** periods bought in advance */
  upcoming: { id: string; plan: string; startsAt: Date; endsAt: Date }[];
  /** end of the last paid period (current or upcoming), or of the most recent one */
  endsAt: Date | null;
  graceEndsAt: Date | null;
  inGrace: boolean;
};

export async function subscriptionState(userId: string, now = new Date()): Promise<SubState> {
  const subs = await db.subscription.findMany({ where: { userId, cancelledAt: null }, orderBy: { startsAt: "asc" } });
  const current = subs.find((s) => s.startsAt <= now && s.endsAt > now) ?? null;
  const upcoming = subs.filter((s) => s.startsAt > now);
  const last = subs.at(-1) ?? null;
  const endsAt = last?.endsAt ?? null;
  const graceEndsAt = endsAt ? addDays(endsAt, config.subscription.graceDays) : null;
  return {
    current: current && { id: current.id, plan: current.plan, planId: current.planId, startsAt: current.startsAt, endsAt: current.endsAt },
    upcoming: upcoming.map((s) => ({ id: s.id, plan: s.plan, startsAt: s.startsAt, endsAt: s.endsAt })),
    endsAt,
    graceEndsAt,
    inGrace: !current && !upcoming.length && !!graceEndsAt && endsAt! <= now && graceEndsAt > now,
  };
}

/** Add a period for a confirmed payment (idempotent per payment) */
export async function addPeriod(userId: string, paymentId: string, plan: { id: string; code: string; days: number }) {
  const existing = await db.subscription.findUnique({ where: { paymentId } });
  if (existing) return existing;
  const now = new Date();
  const last = await db.subscription.findFirst({ where: { userId, cancelledAt: null }, orderBy: { endsAt: "desc" } });
  const startsAt = last && last.endsAt > now ? last.endsAt : now;
  const endsAt = new Date(startsAt.getTime() + plan.days * DAY);
  const sub = await db.subscription.create({
    data: { userId, plan: plan.code, planId: plan.id, startsAt, endsAt, graceEndsAt: addDays(endsAt, config.subscription.graceDays), paymentId },
  });
  await applyRetention(userId);
  return sub;
}

/** Cancel the period bought with `paymentId` (refund) and move later periods up */
export async function cancelPeriod(paymentId: string) {
  const sub = await db.subscription.findUnique({ where: { paymentId } });
  if (!sub || sub.cancelledAt) return null;
  const now = new Date();
  await db.subscription.update({ where: { id: sub.id }, data: { cancelledAt: now, endsAt: sub.startsAt < now ? now : sub.endsAt } });
  await reflow(sub.userId, now);
  await applyRetention(sub.userId);
  return sub;
}

/** Re-chain periods that have not started yet so there are no gaps after a cancellation */
export async function reflow(userId: string, now = new Date()) {
  const subs = await db.subscription.findMany({ where: { userId, cancelledAt: null, endsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  let cursor = now;
  for (const s of subs) {
    if (s.startsAt <= now) {
      cursor = s.endsAt;
      continue;
    }
    const dur = s.endsAt.getTime() - s.startsAt.getTime();
    if (s.startsAt.getTime() !== cursor.getTime()) {
      const endsAt = new Date(cursor.getTime() + dur);
      await db.subscription.update({ where: { id: s.id }, data: { startsAt: cursor, endsAt, graceEndsAt: addDays(endsAt, config.subscription.graceDays) } });
      cursor = endsAt;
    } else cursor = s.endsAt;
  }
}

/**
 * Subscribers keep everything until the grace period ends: extend every result that still
 * exists (including ones already marked expired but not deleted, so renewing brings them back).
 */
export async function applyRetention(userId: string) {
  const st = await subscriptionState(userId);
  if (!st.graceEndsAt) return;
  const until = st.graceEndsAt;
  await db.artifact.updateMany({ where: { task: { userId }, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { lt: until } }] }, data: { expiresAt: until } });
  await db.task.updateMany({ where: { userId, resultsExpireAt: { not: null, lt: until } }, data: { resultsExpireAt: until } });
}

export function assertPlanBuyable(plan: { active: boolean; feeTwd: number } | null) {
  if (!plan || !plan.active) throw new HttpError(404, "plan not available");
  if (!Number.isInteger(plan.feeTwd)) throw new HttpError(500, "plan fee must be a whole TWD amount");
}
