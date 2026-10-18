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
 * A plan's multiplier is the usage it includes, as a multiple of its fee, at published model prices:
 *   max usage V = fee × multiplier;  L168 = V ÷ 4.8;  L6 = L168 ÷ 10
 * 30 days = four full 168 h windows + 48 h, and 48 h = 8 six-hour windows, so maxing every window costs
 * 4·L168 + min(L168, 8·L6) = 4.8·L168 = V.
 */
export function planLimits(feeTwd: number, multiplier: number) {
  if (!(feeTwd > 0) || !(multiplier > 0)) return { maxCostTwd: 0, l168Twd: 0, l6Twd: 0 };
  const maxCost = feeTwd * multiplier;
  const l168 = maxCost / 4.8;
  return { maxCostTwd: r2(maxCost), l168Twd: r2(l168), l6Twd: r2(l168 / 10) };
}

/** The same windows from a max usage directly (the free plan: no fee, an allowance set by the admin) */
export function limitsFromMax(maxCostTwd: number) {
  if (!(maxCostTwd > 0)) return { maxCostTwd: 0, l168Twd: 0, l6Twd: 0 };
  const l168 = maxCostTwd / 4.8;
  return { maxCostTwd: r2(maxCostTwd), l168Twd: r2(l168), l6Twd: r2(l168 / 10) };
}

/**
 * Published prices are vendor cost × buffer, so a user who uses the whole allowance costs fee × multiplier ÷ buffer
 * in vendor fees. Margin = fee ÷ that = buffer ÷ multiplier: ≥ 1 breaks even, ≥ HEALTHY_MARGIN is healthy.
 * Profit therefore comes from the buffer set in /admin, not from the plan.
 */
export const planMargin = (multiplier: number, buffer: number) => (multiplier > 0 && buffer > 0 ? buffer / multiplier : 0);

/** The smallest buffer at which every given multiplier still reaches `margin` */
export const bufferFor = (multipliers: number[], margin = 1) => Math.max(0, ...multipliers) * margin;
