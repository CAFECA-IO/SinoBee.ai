import { db } from "./db";
import { config } from "./config";

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400_000);

export async function activeSubscription(userId: string, at = new Date()) {
  return db.subscription.findFirst({ where: { userId, cancelledAt: null, startsAt: { lte: at }, endsAt: { gt: at } }, orderBy: { endsAt: "desc" } });
}

/** End of the grace period after the user's last paid period, or null when they never subscribed */
async function graceEnd(userId: string, at = new Date()): Promise<Date | null> {
  const last = await db.subscription.findFirst({ where: { userId, cancelledAt: null }, orderBy: { endsAt: "desc" } });
  if (!last) return null;
  const g = addDays(last.endsAt, config.subscription.graceDays);
  return g > at ? g : null;
}

/**
 * How long results stay downloadable after a task finishes:
 *  - subscribers (and users in their 30-day grace period): until the grace period ends; extended on every renewal
 *  - everyone else: RETENTION_FREE_DAYS (7). Deletion itself is paused unless RETENTION_DELETE=1 (only marked expired)
 */
export async function resultsRetentionDays(userId: string): Promise<number> {
  const g = await graceEnd(userId);
  const free = config.retention.freeDays;
  return g ? Math.max(free, Math.ceil((g.getTime() - Date.now()) / 86400_000)) : free;
}

/** When the user's container may be removed: the grace end for subscribers, otherwise 7 days after the last task */
export async function containerExpiry(userId: string, from = new Date()): Promise<Date> {
  const g = await graceEnd(userId);
  const free = addDays(from, config.retention.freeDays);
  return g && g > free ? g : free;
}
