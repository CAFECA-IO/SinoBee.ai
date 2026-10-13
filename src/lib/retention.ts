import { db } from "./db";
import { config } from "./config";

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400_000);

export async function activeSubscription(userId: string, at = new Date()) {
  return db.subscription.findFirst({ where: { userId, startsAt: { lte: at }, endsAt: { gt: at } }, orderBy: { endsAt: "desc" } });
}

/**
 * How long results stay downloadable after a task finishes:
 *  - non-subscribers: RETENTION_FREE_DAYS (7)
 *  - subscribers: RETENTION_SUBSCRIBER_DAYS (90), but never shorter than 7 days
 */
export async function resultsRetentionDays(userId: string): Promise<number> {
  return (await activeSubscription(userId)) ? Math.max(config.retention.subscriberDays, config.retention.freeDays) : config.retention.freeDays;
}

/** When the user's container may be removed (7 days after the last task for non-subscribers) */
export async function containerExpiry(userId: string, from = new Date()): Promise<Date> {
  const sub = await activeSubscription(userId);
  const free = addDays(from, config.retention.freeDays);
  return sub && sub.endsAt > free ? sub.endsAt : free;
}
