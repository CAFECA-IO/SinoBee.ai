/**
 * User levels (2026-10-23). A subscriber's level follows the total months they have been subscribed — paid days
 * already elapsed, refunded (cancelled) periods left out, divided by 30 and rounded up — through the Fibonacci
 * numbers 1, 2, 3, 5, 8, 13, 21, 34. Each level raises the 6-hour limit and the weekly cap (never the weekly grant,
 * so the plan's margin is unchanged), up to +20 %. Breaks in the subscription do not lower the level. Users
 * without a subscription period have level 0 and no bonus.
 */

export const LEVEL_MONTHS = [1, 2, 3, 5, 8, 13, 21, 34] as const;
export const LEVEL_BONUS = [0, 0.02, 0.04, 0.06, 0.09, 0.12, 0.16, 0.2] as const;

const DAY = 86400_000;

export type Level = {
  /** 0 (never subscribed) … 8 */
  n: number;
  /** total subscribed months (rounded up) */
  months: number;
  /** extra share of L6 and the weekly cap, 0 … 0.2 */
  bonus: number;
  /** months needed for the next level, null at the top */
  next: number | null;
};

export function levelFor(months: number): Level {
  const n = LEVEL_MONTHS.filter((m) => months >= m).length;
  return { n, months, bonus: n > 0 ? LEVEL_BONUS.at(n - 1)! : 0, next: n < LEVEL_MONTHS.length ? LEVEL_MONTHS.at(n)! : null };
}

/** Total subscribed months at `at` from the user's periods (cancelled ones already filtered out) */
export function monthsAt(periods: { startsAt: Date; endsAt: Date }[], at: Date): number {
  let ms = 0;
  for (const p of periods) ms += Math.max(0, Math.min(at.getTime(), p.endsAt.getTime()) - p.startsAt.getTime());
  return ms > 0 ? Math.ceil(ms / (30 * DAY) - 1e-9) : 0;
}

export const levelAt = (periods: { startsAt: Date; endsAt: Date }[], at: Date) => levelFor(monthsAt(periods, at));
