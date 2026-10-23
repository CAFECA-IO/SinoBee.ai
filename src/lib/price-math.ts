/**
 * Pure price/plan arithmetic shared by the server and the admin forms (no database imports here),
 * so the live preview in /admin and the saved values can never differ.
 */

/** Published price (TWD per 1M tokens) = vendor USD × FX × buffer, rounded to 4 decimals */
export const publishedTwd = (usd: number, fx: number, buffer: number) => Math.round(usd * fx * buffer * 1e4) / 1e4;

/** One formatter for every place a price is shown (pricing page, backend, task form) */
export const formatPrice = (twd: number) =>
  twd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: twd >= 100 ? 2 : 4 });

/** Upper bound for a plan's usage multiplier (max usage ÷ fee) */
export const MAX_MULTIPLIER = 100;

/** Plan margin at or above this is shown as healthy (the fee earns ≥ 50% over the worst-case vendor cost) */
export const HEALTHY_MARGIN = 1.5;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Plans in working hours (工時, 2026-10-23). A month is 22 working days of 6 hours = 132 工時; a plan's multiplier
 * is the usage it includes per 30 days, as a multiple of its fee, at published model prices:
 *   V (30-day usage) = fee × multiplier = 132 工時 → one 工時 R = V ÷ 132
 *   L6  (rolling 6 hours)  = 6 R = V ÷ 22          one working day
 *   weekly grant            = V × 7 ÷ 30           4.4 R per subscribed day, credited on Sunday 00:00 UTC
 *   L168 (weekly cap)       = 16 × L6              what a week may use: grant + carry-over, capped here
 * Unused weekly quota carries over while the subscription runs unbroken, so over any span use ≤ the grants of the
 * days paid for: the worst-case vendor cost stays V ÷ buffer per 30 days and the margin buffer ÷ multiplier.
 * User levels raise L6 and the cap (not the grant), see src/lib/level.ts.
 */
export const WORKDAYS_PER_MONTH = 22;
export const HOURS_PER_DAY = 6;
export const WEEK_CAP_DAYS = 16;
export const weekGrantTwd = (maxCostTwd: number) => (maxCostTwd > 0 ? (maxCostTwd * 7) / 30 : 0);

export function planLimits(feeTwd: number, multiplier: number) {
  if (!(feeTwd > 0) || !(multiplier > 0)) return { maxCostTwd: 0, l168Twd: 0, l6Twd: 0 };
  return limitsFromMax(feeTwd * multiplier);
}

/** The same limits from a 30-day usage directly (the free plan: no fee, an allowance set by the admin) */
export function limitsFromMax(maxCostTwd: number) {
  if (!(maxCostTwd > 0)) return { maxCostTwd: 0, l168Twd: 0, l6Twd: 0 };
  const l6 = r2(maxCostTwd / WORKDAYS_PER_MONTH);
  return { maxCostTwd: r2(maxCostTwd), l168Twd: r2(l6 * WEEK_CAP_DAYS), l6Twd: l6 };
}

/**
 * Published prices are vendor cost × buffer, so a user who uses the whole allowance costs fee × multiplier ÷ buffer
 * in vendor fees. Margin = fee ÷ that = buffer ÷ multiplier: ≥ 1 breaks even, ≥ HEALTHY_MARGIN is healthy.
 * Profit therefore comes from the buffer set in /admin, not from the plan.
 */
export const planMargin = (multiplier: number, buffer: number) => (multiplier > 0 && buffer > 0 ? buffer / multiplier : 0);

/** The smallest buffer at which every given multiplier still reaches `margin` */
export const bufferFor = (multipliers: number[], margin = 1) => Math.max(0, ...multipliers) * margin;
