/**
 * Pure price/plan arithmetic shared by the server and the admin forms (no database imports here),
 * so the live preview in /admin and the saved values can never differ.
 */

/** Published price (TWD per 1M tokens) = vendor USD × FX × buffer, rounded to 4 decimals */
export const publishedTwd = (usd: number, fx: number, buffer: number) => Math.round(usd * fx * buffer * 1e4) / 1e4;

/** One formatter for every place a price is shown (pricing page, backend, task form) */
export const formatPrice = (twd: number) =>
  twd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: twd >= 100 ? 2 : 4 });

/** fee ÷ max cost must be at least this (the fee earns ≥ 50% over the worst-case cost) */
export const MIN_MULTIPLIER = 1.5;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 *   max cost V = fee ÷ multiplier;  L168 = V ÷ 4.8;  L6 = L168 ÷ 10
 * 30 days = four full 168 h windows + 48 h, and 48 h = 8 six-hour windows, so maxing every window costs
 * 4·L168 + min(L168, 8·L6) = 4.8·L168 = V.
 */
export function planLimits(feeTwd: number, multiplier: number) {
  if (!(feeTwd > 0) || !(multiplier > 0)) return { maxCostTwd: 0, l168Twd: 0, l6Twd: 0 };
  const maxCost = feeTwd / multiplier;
  const l168 = maxCost / 4.8;
  return { maxCostTwd: r2(maxCost), l168Twd: r2(l168), l6Twd: r2(l168 / 10) };
}
