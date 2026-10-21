import { db } from "../db";

/**
 * Vendor breaker (2026-10-21). An upstream answer that says our own account cannot be used - a rejected or revoked key
 * (401 / 403), payment required (402), no credits / insufficient quota / billing - will not go away on a retry, so
 * the vendor is taken out at once for 30 minutes instead of after 4 failures: the relay answers right away with code
 * "vendor_down" (SinoBee asks the allocation for another model) and /route leaves the vendor out.
 *
 * The mark is the refunded ledger row's error ("upstream hard <status>: …"), so every server process sees it.
 */

export const HARD_MS = 30 * 60_000;

const HARD_TEXT = /insufficient_quota|no credits|credits? (remaining|balance)|add credits|billing|payment required|exceeded your current quota|quota exceeded|account (is )?(suspended|deactivated|disabled)|invalid[_ ]api[_ ]key|incorrect api key|api key (not valid|invalid|expired)|permission[_ ]denied/i;

/** A configuration failure of our account at the vendor (not a passing overload) */
export function hardFailure(status: number, message: string): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  return (status === 429 || status === 400 || status >= 500) && HARD_TEXT.test(message);
}

export const hardReason = (status: number, message: string) => `upstream hard ${status}: ${message.slice(0, 300)}`;

/** Vendors taken out by a hard failure in the last 30 minutes: vendor → {until, reason} */
export async function downVendors(now = new Date()) {
  const rows = await db.usageLedger.findMany({
    where: { status: "REFUNDED", createdAt: { gt: new Date(now.getTime() - HARD_MS) }, error: { startsWith: "upstream hard" } },
    select: { modelId: true, createdAt: true, error: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const out = new Map<string, { until: Date; reason: string }>();
  for (const r of rows) {
    const v = r.modelId.split("/")[0];
    if (!out.has(v)) out.set(v, { until: new Date(r.createdAt.getTime() + HARD_MS), reason: r.error ?? "" });
  }
  return out;
}

export async function vendorDown(vendor: string, now = new Date()) {
  return (await downVendors(now)).get(vendor) ?? null;
}
