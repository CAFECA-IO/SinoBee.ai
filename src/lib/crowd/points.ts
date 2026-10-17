import { db } from "../db";
import { HttpError } from "../errors";

/**
 * Platform points: 1 point = NT$1. Earned when a crowdfunded task finishes under budget (the backer's share of the
 * leftover), spent only on crowdfunding pledges. Not transferable and never paid out in cash. Every change is one
 * PointLedger row; `ref` makes each grant or spend happen at most once.
 */

export async function pointBalance(userId: string): Promise<number> {
  const r = await db.pointLedger.aggregate({ where: { userId }, _sum: { delta: true } });
  return r._sum.delta ?? 0;
}

/** Add (or, with a negative delta, take) points once per `ref`. Returns false when that ref was already booked. */
export async function bookPoints(p: { userId: string; delta: number; reason: string; ref: string; taskId?: string | null; note?: string }): Promise<boolean> {
  if (!Number.isInteger(p.delta) || p.delta === 0) return false;
  const exists = await db.pointLedger.findUnique({ where: { ref: p.ref } });
  if (exists) return false;
  try {
    await db.pointLedger.create({ data: { userId: p.userId, delta: p.delta, reason: p.reason, ref: p.ref, taskId: p.taskId ?? null, note: p.note ?? null } });
    return true;
  } catch (e) {
    // unique ref raced with another worker: already booked
    if ((e as { code?: string }).code === "P2002") return false;
    throw e;
  }
}

/** Spend points for a pledge; refuses when the balance is short (checked again after booking to stop double spends) */
export async function spendPoints(userId: string, amount: number, ref: string, taskId: string) {
  if ((await pointBalance(userId)) < amount) throw new HttpError(400, "not enough points");
  await bookPoints({ userId, delta: -amount, reason: "pledge", ref, taskId });
  if ((await pointBalance(userId)) < 0) {
    await db.pointLedger.deleteMany({ where: { ref } });
    throw new HttpError(409, "not enough points");
  }
}

export async function pointHistory(userId: string, take = 50) {
  return db.pointLedger.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
}
