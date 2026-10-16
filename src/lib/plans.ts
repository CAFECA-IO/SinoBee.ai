import { db } from "./db";
import { HttpError } from "./errors";
import { audit } from "./roles";
import { MIN_MULTIPLIER, planLimits as limits } from "./price-math";

/**
 * Subscription plans (30-day periods, no auto-renewal).
 *
 *   max cost V  = fee ÷ multiplier          (TWD at published model prices, the most a user can spend in 30 days)
 *   L168        = V ÷ 4.8                   (rolling 7-day limit)
 *   L6          = L168 ÷ 10                 (rolling 6-hour limit)
 *
 * 30 days hold four full 168 h windows plus 48 h; 48 h hold 8 six-hour windows, so a user who maxes every window
 * spends 4·L168 + min(L168, 8·L6) = 4·L168 + 0.8·L168 = 4.8·L168 = V. The multiplier (fee ÷ V) must stay ≥ 1.5,
 * i.e. the fee earns at least 50% over the worst-case cost.
 */
export { MIN_MULTIPLIER } from "./price-math";

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

export const DEFAULT_PLANS = [
  { code: "low", name: "低用量", nameEn: "Light", feeTwd: 840, multiplier: 3, concurrency: 2, sortOrder: 10 },
  { code: "high", name: "高用量", nameEn: "Heavy", feeTwd: 3675, multiplier: 1.5, concurrency: 6, sortOrder: 20 },
];

export async function ensurePlans() {
  if ((await db.plan.count()) > 0) return;
  for (const p of DEFAULT_PLANS) await db.plan.create({ data: { ...p, ...planLimits(p.feeTwd, p.multiplier), days: 30 } });
}

export async function listPlans(opts: { activeOnly?: boolean } = {}): Promise<PlanView[]> {
  await ensurePlans();
  const rows = await db.plan.findMany({ where: opts.activeOnly ? { active: true } : {}, orderBy: [{ sortOrder: "asc" }, { feeTwd: "asc" }] });
  return rows.map(view);
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

/** Create or update a plan. Refuses a multiplier under 1.5 (fee ÷ max cost). L6/L168 are always recomputed. */
export async function savePlan(actorId: string, p: PlanInput): Promise<PlanView> {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(p.code)) throw new HttpError(400, "code must be a short slug");
  if (!p.name.trim() || !p.nameEn.trim()) throw new HttpError(400, "name is required");
  if (!(Number.isFinite(p.feeTwd) && p.feeTwd >= 1 && p.feeTwd <= 1_000_000)) throw new HttpError(400, "fee out of range");
  if (!Number.isFinite(p.multiplier) || p.multiplier < MIN_MULTIPLIER) throw new HttpError(400, `fee ÷ max cost must be at least ${MIN_MULTIPLIER}`);
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
