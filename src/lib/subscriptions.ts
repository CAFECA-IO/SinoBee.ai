import { db } from "./db";
import { config } from "./config";
import { HttpError } from "./errors";
import { addDays } from "./retention";

/**
 * Subscription periods: 30 days each; automatic renewal is off unless the user turns it on (src/lib/auto-renew.ts). Buying the same or a cheaper plan again stacks a new period
 * after the last one. Buying a more expensive plan while a period is running is an upgrade: it starts right away,
 * the running period ends now and its unused time is converted to extra days on the new plan at equal value
 * (unused days × old fee per day ÷ new fee per day); periods bought in advance move up behind it. Results and the container are kept while subscribed and for `graceDays` (30) after the last period ends.
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

/** Add a period for a confirmed payment (idempotent per payment); a more expensive plan than the running one upgrades now */
export async function addPeriod(userId: string, paymentId: string, plan: { id: string; code: string; days: number }, opts: { after?: Date } = {}) {
  const existing = await db.subscription.findUnique({ where: { paymentId } });
  if (existing) return existing;
  const now = new Date();
  const last = await db.subscription.findFirst({ where: { userId, cancelledAt: null }, orderBy: { endsAt: "desc" } });
  // after: the end of the period an automatic renewal was charged for; a late confirmation still joins it without a gap
  const joins = !!last && !!opts.after && last.endsAt.getTime() === opts.after.getTime();
  const startsAt = last && (last.endsAt > now || joins) ? last.endsAt : now;
  const endsAt = new Date(startsAt.getTime() + plan.days * DAY);
  const sub = await db.subscription.create({
    data: { userId, plan: plan.code, planId: plan.id, startsAt, endsAt, graceEndsAt: addDays(endsAt, config.subscription.graceDays), paymentId },
  });
  const upgraded = await upgradeNow(userId, sub.id, now);
  await applyRetention(userId);
  return upgraded ?? sub;
}

const feePerDay = (p: { feeTwd: unknown; days: number }) => Number(p.feeTwd) / (p.days || 30);

/**
 * Extra time on `to` worth the unused part of the running period on `from` (ms):
 * unused × (from fee per day ÷ to fee per day).
 */
export function upgradeCreditMs(remainingMs: number, from: { feeTwd: unknown; days: number }, to: { feeTwd: unknown; days: number }) {
  const a = feePerDay(from);
  const b = feePerDay(to);
  return remainingMs > 0 && a > 0 && b > 0 ? Math.floor((remainingMs * a) / b) : 0;
}

async function planOf(s: { planId: string | null; plan: string }) {
  return (s.planId ? await db.plan.findUnique({ where: { id: s.planId } }) : null) ?? (await db.plan.findUnique({ where: { code: s.plan } }));
}

/**
 * If period `subId` (not started yet) is on a more expensive plan than the period running at `now`, start it now:
 * the running period ends now, its unused time is added to `subId` at equal value, later periods move up.
 * Returns the updated period, or null when it is not an upgrade.
 */
export async function upgradeNow(userId: string, subId: string, now = new Date()) {
  const target = await db.subscription.findUnique({ where: { id: subId } });
  if (!target || target.cancelledAt || target.startsAt <= now) return null;
  const cur = await db.subscription.findFirst({ where: { userId, cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: "desc" } });
  if (!cur) return null;
  const [from, to] = await Promise.all([planOf(cur), planOf(target)]);
  if (!from || !to || !(Number(to.feeTwd) > Number(from.feeTwd))) return null;
  const credit = upgradeCreditMs(cur.endsAt.getTime() - now.getTime(), from, to);
  const length = target.endsAt.getTime() - target.startsAt.getTime();
  const endsAt = new Date(now.getTime() + length + credit);
  await db.subscription.update({ where: { id: cur.id }, data: { endsAt: now, graceEndsAt: addDays(now, config.subscription.graceDays) } });
  const up = await db.subscription.update({ where: { id: target.id }, data: { startsAt: now, endsAt, graceEndsAt: addDays(endsAt, config.subscription.graceDays) } });
  await reflow(userId, now);
  return db.subscription.findUniqueOrThrow({ where: { id: up.id } });
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
