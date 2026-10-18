import { db } from "./db";
import { HttpError } from "./errors";
import { audit } from "./roles";
import { MAX_MULTIPLIER, limitsFromMax, planLimits as limits } from "./price-math";

/**
 * Subscription plans (30-day periods, no auto-renewal).
 *
 *   max usage V = fee × multiplier          (TWD at published model prices, the most a user can use in 30 days)
 *   L168        = V ÷ 4.8                   (rolling 7-day limit)
 *   L6          = L168 ÷ 10                 (rolling 6-hour limit)
 *
 * 30 days hold four full 168 h windows plus 48 h; 48 h hold 8 six-hour windows, so a user who maxes every window
 * uses 4·L168 + min(L168, 8·L6) = 4·L168 + 0.8·L168 = 4.8·L168 = V.
 *
 * Published prices = vendor cost × buffer, so the worst-case vendor cost is V ÷ buffer and the margin is
 * buffer ÷ multiplier (see planMargin). The admin keeps the buffer high enough; plans themselves are not capped.
 */
export { MAX_MULTIPLIER } from "./price-math";

export function planLimits(feeTwd: number, multiplier: number) {
  if (!(feeTwd > 0)) throw new HttpError(400, "fee must be positive");
  if (!(multiplier > 0)) throw new HttpError(400, "multiplier must be positive");
  return limits(feeTwd, multiplier);
}

export type PlanView = {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  feeTwd: number;
  multiplier: number;
  maxCostTwd: number;
  l6Twd: number;
  l168Twd: number;
  concurrency: number;
  days: number;
  active: boolean;
  sortOrder: number;
};

type Row = Awaited<ReturnType<typeof db.plan.findMany>>[number];
const view = (p: Row): PlanView => ({
  id: p.id, code: p.code, name: p.name, nameEn: p.nameEn, feeTwd: Number(p.feeTwd), multiplier: Number(p.multiplier),
  maxCostTwd: Number(p.maxCostTwd), l6Twd: Number(p.l6Twd), l168Twd: Number(p.l168Twd),
  concurrency: p.concurrency, days: p.days, active: p.active, sortOrder: p.sortOrder,
});

/** The free plan: users without a subscription get its allowance (no fee; managed in /admin → Plans) */
export const FREE_PLAN = "free";
/** Default free allowance: this share of the Pro plan's */
export const FREE_SHARE = 20;

export const DEFAULT_PLANS = [
  { code: "low", name: "Pro", nameEn: "Pro", feeTwd: 840, multiplier: 1.5, concurrency: 2, sortOrder: 10 },
  { code: "high", name: "Ultra", nameEn: "Ultra", feeTwd: 3675, multiplier: 5, concurrency: 6, sortOrder: 20 },
];

const pg = globalThis as unknown as { __sbPlansReady?: boolean };

export async function ensurePlans() {
  if (pg.__sbPlansReady) return;
  if ((await db.plan.count({ where: { code: { not: FREE_PLAN } } })) === 0)
    for (const p of DEFAULT_PLANS) await db.plan.create({ data: { ...p, ...planLimits(p.feeTwd, p.multiplier), days: 30 } }).catch(() => undefined);
  if (!(await db.plan.findUnique({ where: { code: FREE_PLAN } }))) {
    // 1/20 of Pro (the cheapest paid plan when there is no "low" plan)
    const pro = (await db.plan.findUnique({ where: { code: "low" } })) ?? (await db.plan.findFirst({ where: { code: { not: FREE_PLAN }, feeTwd: { gt: 0 } }, orderBy: { feeTwd: "asc" } }));
    const max = pro ? Number(pro.maxCostTwd) / FREE_SHARE : 0;
    await db.plan
      .create({ data: { code: FREE_PLAN, name: "免費", nameEn: "Free", feeTwd: 0, multiplier: 0, ...limitsFromMax(max), concurrency: 1, days: 30, active: true, sortOrder: 0 } })
      .catch(() => undefined); // created meanwhile
  }
  pg.__sbPlansReady = true;
}

/** Paid plans (the free plan only with includeFree) */
export async function listPlans(opts: { activeOnly?: boolean; includeFree?: boolean } = {}): Promise<PlanView[]> {
  await ensurePlans();
  const rows = await db.plan.findMany({
    where: { ...(opts.activeOnly ? { active: true } : {}), ...(opts.includeFree ? {} : { code: { not: FREE_PLAN } }) },
    orderBy: [{ sortOrder: "asc" }, { feeTwd: "asc" }],
  });
  return rows.map(view);
}

/** The free plan (null when it is switched off, with activeOnly) */
export async function freePlan(opts: { activeOnly?: boolean } = {}): Promise<PlanView | null> {
  await ensurePlans();
  const row = await db.plan.findUnique({ where: { code: FREE_PLAN } });
  if (!row || (opts.activeOnly && (!row.active || !(Number(row.maxCostTwd) > 0)))) return null;
  return view(row);
}

export type FreePlanInput = { name: string; nameEn: string; maxCostTwd: number; concurrency: number; active: boolean };

/** The free plan's allowance: max usage per 30 days at published prices (L168 / L6 derived as for paid plans) */
export async function saveFreePlan(actorId: string, p: FreePlanInput): Promise<PlanView> {
  if (!p.name.trim() || !p.nameEn.trim()) throw new HttpError(400, "name is required");
  if (!(Number.isFinite(p.maxCostTwd) && p.maxCostTwd >= 0 && p.maxCostTwd <= 100_000)) throw new HttpError(400, "allowance out of range");
  if (!(Number.isInteger(p.concurrency) && p.concurrency >= 1 && p.concurrency <= 64)) throw new HttpError(400, "concurrency must be 1–64");
  const before = await freePlan();
  const row = await db.plan.update({
    where: { code: FREE_PLAN },
    data: { name: p.name.trim(), nameEn: p.nameEn.trim(), ...limitsFromMax(p.maxCostTwd), concurrency: p.concurrency, active: p.active },
  });
  await audit(actorId, "plan.update", { type: "plan", id: row.id }, { before, after: view(row) });
  return view(row);
}

export type PlanInput = {
  id?: string;
  code: string;
  name: string;
  nameEn: string;
  feeTwd: number;
  multiplier: number;
  concurrency: number;
  active: boolean;
  sortOrder?: number;
};

/** Create or update a plan (multiplier = max usage ÷ fee, 0 < m ≤ 100). L6/L168 are always recomputed. */
export async function savePlan(actorId: string, p: PlanInput): Promise<PlanView> {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(p.code)) throw new HttpError(400, "code must be a short slug");
  if (p.code === FREE_PLAN) throw new HttpError(400, "the free plan is edited on its own form");
  if (!p.name.trim() || !p.nameEn.trim()) throw new HttpError(400, "name is required");
  if (!(Number.isFinite(p.feeTwd) && p.feeTwd >= 1 && p.feeTwd <= 1_000_000)) throw new HttpError(400, "fee out of range");
  if (!(Number.isFinite(p.multiplier) && p.multiplier > 0 && p.multiplier <= MAX_MULTIPLIER)) throw new HttpError(400, `multiplier must be between 0 and ${MAX_MULTIPLIER}`);
  if (!(Number.isInteger(p.concurrency) && p.concurrency >= 1 && p.concurrency <= 64)) throw new HttpError(400, "concurrency must be 1–64");
  const fee = Math.round(p.feeTwd * 100) / 100;
  const data = {
    code: p.code, name: p.name.trim(), nameEn: p.nameEn.trim(), feeTwd: fee, multiplier: p.multiplier,
    ...planLimits(fee, p.multiplier), concurrency: p.concurrency, days: 30, active: p.active, sortOrder: p.sortOrder ?? 0,
  };
  const before = p.id ? await db.plan.findUnique({ where: { id: p.id } }) : null;
  if (p.id && !before) throw new HttpError(404, "plan not found");
  const clash = await db.plan.findUnique({ where: { code: p.code } });
  if (clash && clash.id !== p.id) throw new HttpError(409, "a plan with this code exists");
  const row = before ? await db.plan.update({ where: { id: before.id }, data }) : await db.plan.create({ data });
  await audit(actorId, before ? "plan.update" : "plan.create", { type: "plan", id: row.id }, { before: before ? view(before) : null, after: view(row) });
  return view(row);
}
