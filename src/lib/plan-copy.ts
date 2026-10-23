/**
 * How plans describe themselves (pricing and subscribe pages, 2026-10-24): no token counts or allowance amounts,
 * only how each plan compares with the one before it (free → the cheapest paid plan → the next …).
 */

export type PlanLike = { code: string; name: string; nameEn: string; maxCostTwd: number; concurrency: number; feeTwd: number };

/** "16", "4.4": a whole number when the ratio is within 0.05 of one, else one decimal */
export function times(a: number, b: number): string | null {
  if (!(a > 0) || !(b > 0)) return null;
  const r = a / b;
  return Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r)) : r.toFixed(1);
}

/** The plans in the order they are compared: the free plan (when offered) first, then by fee */
export function ladder<T extends PlanLike>(free: T | null, paid: T[]): { plan: T; prev: T | null; index: number }[] {
  const all = [...(free ? [free] : []), ...[...paid].sort((x, y) => x.feeTwd - y.feeTwd)];
  return all.map((plan, index) => ({ plan, prev: index > 0 ? all.at(index - 1)! : null, index }));
}

/** A plan's name inside a sentence: "免費方案" for the free plan in Chinese, Latin names spaced from Chinese text */
export function inSentence(p: { name: string; nameEn: string; feeTwd: number }, zh: boolean): string {
  if (!zh) return p.nameEn;
  if (p.feeTwd <= 0 && !/方案$/.test(p.name)) return `${p.name}方案`;
  return /^[\x20-\x7e]+$/.test(p.name) ? ` ${p.name} ` : p.name;
}
