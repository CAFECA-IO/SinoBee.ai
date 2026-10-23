import { db, dbKind } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { audit } from "../roles";
import { referenceBlended, type ModelPriceView } from "../models";
import { freePlan, listPlans, type PlanView } from "../plans";
import { weekGrantTwd } from "../price-math";
import { levelAt, type Level } from "../level";
import { subscriptionState } from "../subscriptions";
import { bookPoints, pointBalance } from "../crowd/points";
import type { UsageLedger } from "@/generated/prisma/client";

/**
 * Subscription quota for the model relay (plan v6 §4).
 *
 *  hold     prompt tokens + expected output (stream: the user's average for the model, default 800;
 *           non-stream: the max_tokens we let through) at the published price, checked against both
 *           windows (rolling 6 h ≤ L6, calendar week ≤ L168) in one locked step so concurrent calls cannot overshoot
 *  top-up   streams that outgrow the hold reserve another 256 output tokens; when that no longer fits the
 *           stream ends with finish_reason "quota"
 *  settle   from the upstream usage report as soon as the call ends (well within 2 s); without one, from
 *           our own count (ESTIMATED); upstream errors before any output refund the hold. The charge is capped at
 *           the hold, so the windows never exceed the plan limits
 *  sweep    holds older than 10 minutes are settled at the hold (EXPIRED) and logged
 *
 * Window membership: HELD rows count at heldTwd from createdAt; settled rows count at settledTwd from settledAt.
 *  6h    rolling: a cost frees up 6 h after the moment it was incurred
 *  168h  the calendar week, Sunday 00:00:00 UTC to the next Sunday (the key stays "168h" for SinoBee and the
 *        response headers). Since 2026-10-23 a week may use its grant (V × 7 ÷ 30, prorated to the days paid for)
 *        plus what the week before left unused, capped at L168 = 16 × L6 (weekBudget). The carry-over only lives
 *        while the subscription runs without a gap; a gap starts again from nothing. Users without a subscription
 *        (free plan) get their weekly grant only.
 * Levels (src/lib/level.ts) raise L6 and the weekly cap by up to 20 % (ctx.limits); the grant stays the plan's.
 * An admin may reset either window for one user (resetWindows): costs incurred up to that moment no longer count in
 * it (User.quotaReset6hAt / quotaResetWeekAt). Calls still running then count when they settle.
 *
 * Platform points (plan "模型分配與備援機制" P3, 2026-10-21): a call sent with `x-sinobee-billing: points` (the user
 * agreed in SinoBee) is held against the points balance instead of the windows and leaves the windows alone. Points
 * are charged 1:1 at the published TWD price (1 point = NT$1): after each settled points call the running total is
 * rounded up to whole points and the difference booked (PointLedger reason "llm_usage", ref "llm:<ledger id>").
 */

export const W6 = 6 * 3600_000;
export const W168 = 168 * 3600_000;

/** Start of the quota week containing `now`: the last Sunday 00:00:00 UTC (inclusive) */
export function weekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
/** The next weekly reset after `now` (exclusive end of the current quota week) */
export const weekEnd = (now = new Date()) => new Date(weekStart(now).getTime() + W168);

export type Prices = { input: number; cacheRead: number; cacheWrite: number; output: number };
export type Tokens = { prompt: number; output: number; cacheRead?: number; cacheWrite?: number };

/** TWD for a token count at published prices (TWD per 1M tokens); prompt includes cached tokens */
export function costTwd(p: Prices, t: Tokens): number {
  const cr = t.cacheRead ?? 0;
  const cw = t.cacheWrite ?? 0;
  const uncached = Math.max(0, t.prompt - cr - cw);
  return (uncached * p.input + cr * p.cacheRead + cw * p.cacheWrite + t.output * p.output) / 1e6;
}

export class QuotaError extends HttpError {
  constructor(public window: "6h" | "168h" | "concurrency" | "rpm" | "subscription" | "provider" | "points", message: string, public retryAt?: Date) {
    super(window === "subscription" || window === "points" ? 402 : window === "provider" ? 503 : 429, message);
  }
}

// ───────────── per-user lock (in-process; plus an advisory lock on PostgreSQL) ─────────────

const chains = new Map<string, Promise<unknown>>();
async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  chains.set(userId, chained);
  await prev.catch(() => undefined);
  try {
    if (dbKind === "postgres") {
      return await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"llm:" + userId}))`;
        return fn();
      });
    }
    return await fn();
  } finally {
    release();
    if (chains.get(userId) === chained) chains.delete(userId);
  }
}

// ───────────── context ─────────────

/** subscriptionId null: no subscription, the free plan's allowance. billing points: paid with platform points */
/**
 * subscriptionId null: no subscription, the free plan's allowance. billing points: paid with platform points.
 * limits = the plan's L6 and weekly cap raised by the user's level (paid plans only). week caches this week's budget
 * between a hold and the stream's top-ups.
 */
export type QuotaCtx = {
  userId: string;
  subscriptionId: string | null;
  plan: PlanView;
  billing?: "subscription" | "points";
  level: Level;
  limits: { l6: number; cap: number };
  week?: WeekBudget;
};

type Period = { startsAt: Date; endsAt: Date; planId: string | null; plan: string };
const periodsOf = (userId: string): Promise<Period[]> =>
  db.subscription.findMany({ where: { userId, cancelledAt: null }, orderBy: { startsAt: "asc" }, select: { startsAt: true, endsAt: true, planId: true, plan: true } });
const withBonus = (plan: PlanView, bonus: number) => ({ l6: plan.l6Twd * (1 + bonus), cap: plan.l168Twd * (1 + bonus) });

/** The caller's current subscription period and plan, or a 402 */
export async function quotaContext(userId: string, now = new Date()): Promise<QuotaCtx> {
  const st = await subscriptionState(userId, now);
  const level = levelAt(await periodsOf(userId), now);
  if (!st.current) {
    // without a subscription: the free plan, when the admin keeps it on (no level bonus)
    const free = await freePlan({ activeOnly: true });
    if (free) return { userId, subscriptionId: null, plan: free, level, limits: withBonus(free, 0) };
    throw new QuotaError("subscription", "an active SinoBee.ai subscription is required (https://sinobee.ai/subscribe)");
  }
  const plans = await listPlans();
  const plan = plans.find((p) => p.id === st.current!.planId) ?? plans.find((p) => p.code === st.current!.plan);
  if (!plan) throw new QuotaError("subscription", "subscription plan not found");
  return { userId, subscriptionId: st.current.id, plan, level, limits: withBonus(plan, level.bonus) };
}

/** A call paid with platform points: no subscription needed; the plan (when there is one) only sets concurrency */
export async function pointsContext(userId: string): Promise<QuotaCtx> {
  const base = await quotaContext(userId).catch(() => null);
  const plan = base?.plan ?? ({ id: null, code: "points", name: "points", nameEn: "points", concurrency: 2, l6Twd: 0, l168Twd: 0, maxCostTwd: 0 } as unknown as PlanView);
  return { userId, subscriptionId: base?.subscriptionId ?? null, plan, billing: "points", level: base?.level ?? levelAt([], new Date()), limits: base?.limits ?? { l6: 0, cap: 0 } };
}

// ───────────── weekly budget: grant + carry-over, capped ─────────────

export type WeekBudget = {
  weekStart: Date;
  weekEnd: Date;
  /** use counts from here: the week's start, or later when the unbroken subscription run began this week */
  from: Date;
  grantTwd: number;
  carryInTwd: number;
  capTwd: number;
  /** min(cap, carry-in + grant) */
  availableTwd: number;
  /** start of the unbroken run of subscription periods covering now (null: no subscription) */
  runStart: Date | null;
};

/** Start of the unbroken run of periods (no gap at all) that covers `now`, or null */
export function runStart(periods: { startsAt: Date; endsAt: Date }[], now: Date): Date | null {
  const cur = periods.find((p) => p.startsAt <= now && p.endsAt > now);
  if (!cur) return null;
  let start = cur.startsAt;
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of periods) if (p.startsAt < start && p.endsAt >= start) (start = p.startsAt), (changed = true);
  }
  return start;
}

const maxDate = (a: Date, b: Date) => (a > b ? a : b);
const DAY = 86400_000;

/** Paid grant for the week starting `w`: every paid day in it (from `from`) at its plan's V ÷ 30 */
function grantFor(periods: Period[], planOf: (p: Period) => PlanView | undefined, w: Date, from: Date): number {
  const end = w.getTime() + W168;
  let twd = 0;
  for (const p of periods) {
    const ms = Math.min(end, p.endsAt.getTime()) - Math.max(from.getTime(), p.startsAt.getTime());
    if (ms > 0) twd += (weekGrantTwd(planOf(p)?.maxCostTwd ?? 0) / 7) * (ms / DAY);
  }
  return twd;
}

/** Settled subscription use with its time in [from, to), after an admin reset of that week */
async function usedBetween(userId: string, from: Date, to: Date, resetAt: Date | null): Promise<number> {
  const start = resetAt && resetAt >= from && resetAt < to ? new Date(resetAt.getTime() + 1) : from;
  const r = await db.usageLedger.aggregate({ where: { userId, billing: "subscription", status: { not: "HELD" }, settledAt: { gte: start, lt: to } }, _sum: { settledTwd: true } });
  return Math.max(0, Number(r._sum.settledTwd ?? 0));
}

/**
 * This week's budget. Free plan: the plan's weekly grant, no carry. Subscribed: the grant for the days paid within
 * the unbroken run, plus the carry-in, capped at ctx.limits.cap. Carry-ins are computed week by week from the run's
 * first week (each completed week: carry-out = max(0, available − used)) and memoised in QuotaWeek.
 */
export async function weekBudget(ctx: QuotaCtx, now = new Date()): Promise<WeekBudget> {
  const ws = weekStart(now);
  const we = new Date(ws.getTime() + W168);
  if (!ctx.subscriptionId) {
    const grant = weekGrantTwd(ctx.plan.maxCostTwd);
    return { weekStart: ws, weekEnd: we, from: ws, grantTwd: grant, carryInTwd: 0, capTwd: ctx.limits.cap, availableTwd: Math.min(ctx.limits.cap, grant), runStart: null };
  }
  const periods = await periodsOf(ctx.userId);
  const start = runStart(periods, now) ?? now;
  const inRun = periods.filter((p) => p.endsAt > start);
  const plans = await listPlans({ includeFree: true });
  const planOf = (p: Period) => plans.find((x) => x.id === p.planId) ?? plans.find((x) => x.code === p.plan);
  const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { quotaResetWeekAt: true } });
  // carry-in: from the latest memo of this run, else from the run's first week with nothing
  const first = weekStart(start);
  const memo = await db.quotaWeek.findFirst({ where: { userId: ctx.userId, blockStart: start, weekStart: { gte: first, lte: ws } }, orderBy: { weekStart: "desc" } });
  let w = memo?.weekStart ?? first;
  let carry = memo ? Number(memo.carryInTwd) : 0;
  while (w < ws) {
    const next = new Date(w.getTime() + W168);
    const from = maxDate(w, start);
    const last = new Date(next.getTime() - 1);
    const covering = [...inRun].reverse().find((p) => p.startsAt <= last && p.endsAt > from);
    const plan = covering ? planOf(covering) : undefined;
    const cap = plan ? withBonus(plan, levelAt(periods, last).bonus).cap : 0;
    const avail = Math.min(cap, carry + grantFor(inRun, planOf, w, from));
    carry = Math.max(0, avail - (await usedBetween(ctx.userId, from, next, user?.quotaResetWeekAt ?? null)));
    w = next;
    await db.quotaWeek.upsert({
      where: { userId_weekStart: { userId: ctx.userId, weekStart: w } },
      create: { userId: ctx.userId, weekStart: w, blockStart: start, carryInTwd: carry },
      update: { blockStart: start, carryInTwd: carry },
    });
  }
  const from = maxDate(ws, start);
  const grant = grantFor(inRun, planOf, ws, from);
  return { weekStart: ws, weekEnd: we, from, grantTwd: grant, carryInTwd: carry, capTwd: ctx.limits.cap, availableTwd: Math.min(ctx.limits.cap, carry + grant), runStart: start };
}

type Row = Pick<UsageLedger, "status" | "heldTwd" | "settledTwd" | "createdAt" | "settledAt">;
const amount = (r: Row) => Number(r.status === "HELD" ? r.heldTwd : (r.settledTwd ?? 0));
const at = (r: Row) => (r.status === "HELD" ? r.createdAt : (r.settledAt ?? r.createdAt));

/**
 * Where each window starts for this user now: the 6 h window at now − 6 h, the week at Sunday 00:00 UTC, either moved
 * later by an admin reset. Settled rows count when their time is after the start (6 h: strictly; the week: from the
 * Sunday 00:00:00 itself, also strictly after a reset).
 */
async function windowStarts(userId: string, now: Date, weekFrom?: Date) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { quotaReset6hAt: true, quotaResetWeekAt: true } });
  const roll = now.getTime() - W6;
  const week = Math.max(weekStart(now).getTime(), weekFrom?.getTime() ?? -Infinity);
  const r6 = u?.quotaReset6hAt?.getTime() ?? -Infinity;
  const rw = u?.quotaResetWeekAt?.getTime() ?? -Infinity;
  return {
    in6: (t: number) => t > roll && t > r6,
    inWeek: (t: number) => t >= week && t > rw,
    earliest: new Date(Math.min(roll, week)),
  };
}

async function windowRows(userId: string, earliest: Date) {
  return db.usageLedger.findMany({
    where: { userId, billing: "subscription", OR: [{ status: "HELD" }, { settledAt: { gte: earliest } }] },
    select: { status: true, heldTwd: true, settledTwd: true, createdAt: true, settledAt: true },
  });
}

/**
 * Use of both windows (TWD; never below 0, e.g. after quota pledges came back), running holds counted in full.
 * weekFrom: count the week from here (the budget's `from`) instead of Sunday 00:00.
 */
export async function windowUse(userId: string, now = new Date(), weekFrom?: Date) {
  const s = await windowStarts(userId, now, weekFrom);
  const all = await windowRows(userId, s.earliest);
  let w6 = 0;
  let w168 = 0;
  let held = 0;
  const rows: Row[] = [];
  for (const r of all) {
    const a = amount(r);
    const t = at(r).getTime();
    const h = r.status === "HELD";
    if (h) held++;
    const inWeek = h || s.inWeek(t);
    const in6 = h || s.in6(t);
    if (inWeek) w168 += a;
    if (in6) {
      w6 += a;
      if (!h) rows.push(r); // what the 6 h window will release, for retry hints and the timeline
    }
  }
  return { w6: Math.max(0, w6), w168: Math.max(0, w168), held, rows, weekEndsAt: weekEnd(now) };
}

/** When enough settled cost leaves the 6 h window for `need` TWD to fit (for retry hints) */
function retryAt6(rows: Row[], limit: number, used: number, need: number): Date | undefined {
  let excess = used + need - limit;
  const settled = [...rows].sort((a, b) => at(a).getTime() - at(b).getTime());
  for (const r of settled) {
    excess -= amount(r);
    if (excess <= 0) return new Date(at(r).getTime() + W6);
  }
  return undefined;
}

/** How much more (TWD) fits in both windows right now */
export async function headroom(ctx: QuotaCtx, now = new Date()) {
  const wk = await weekBudget(ctx, now);
  const u = await windowUse(ctx.userId, now, wk.from);
  return { ...u, week: wk, free: Math.max(0, Math.min(ctx.limits.l6 - u.w6, wk.availableTwd - u.w168)) };
}

// ───────────── RPM and provider circuit breaker ─────────────

const recent = new Map<string, number[]>();
function checkRpm(userId: string, now: number) {
  const list = (recent.get(userId) ?? []).filter((t) => t > now - 60_000);
  if (list.length >= config.llm.rpm) throw new QuotaError("rpm", `rate limit: ${config.llm.rpm} requests per minute`, new Date(list[0] + 60_000));
  list.push(now);
  recent.set(userId, list);
}
export const resetRpm = () => recent.clear();

async function checkProvider(modelId: string, now: Date) {
  const provider = modelId.split("/")[0];
  const limit = config.llm.dailyLimit(provider);
  if (!limit) return;
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db.usageLedger.findMany({
    where: { modelId: { startsWith: `${provider}/` }, OR: [{ status: "HELD" }, { settledAt: { gte: start } }] },
    select: { status: true, heldTwd: true, settledTwd: true, createdAt: true, settledAt: true },
  });
  const spent = rows.reduce((a, r) => a + amount(r), 0);
  if (spent >= limit) {
    console.warn(`llm circuit breaker: ${provider} spent ${spent.toFixed(2)} / ${limit} TWD today`);
    throw new QuotaError("provider", `${provider} models are temporarily unavailable; try another model`);
  }
}

// ───────────── hold / top-up / settle ─────────────

export async function avgOutput(userId: string, modelId: string) {
  const s = await db.userModelStats.findUnique({ where: { userId_modelId: { userId, modelId } } });
  return s && s.count > 0 ? s.avgOutput : config.llm.defaultAvgOutput;
}

/**
 * Reserve quota for one call. `output` is the output the hold should cover; with `fit`, the output is cut down to
 * what still fits (non-streaming calls, whose max_tokens we then lower) and the chosen value is returned.
 */
export async function hold(
  ctx: QuotaCtx,
  model: ModelPriceView,
  t: { prompt: number; output: number; minOutput?: number },
  meta: { endpoint: string; stream: boolean; deviceId?: string | null; fit?: boolean },
): Promise<{ ledger: UsageLedger; output: number }> {
  const now = new Date();
  checkRpm(ctx.userId, now.getTime());
  await checkProvider(model.modelId, now);
  return withUserLock(ctx.userId, async () => {
    const heldNow = await db.usageLedger.count({ where: { userId: ctx.userId, status: "HELD" } });
    if (heldNow >= ctx.plan.concurrency) throw new QuotaError("concurrency", `at most ${ctx.plan.concurrency} requests at a time on this plan`);
    const p = model.twd;
    if (ctx.billing === "points") {
      const free = await pointsAvailable(ctx.userId);
      const promptCost = costTwd(p, { prompt: t.prompt, output: 0 });
      let output = t.output;
      if (meta.fit) {
        const affordable = p.output > 0 ? Math.floor(((free - promptCost) * 1e6) / p.output) : output;
        output = Math.max(t.minOutput ?? 1, Math.min(output, affordable));
      }
      const need = promptCost + costTwd(p, { prompt: 0, output });
      if (need > free + 1e-9) throw new QuotaError("points", "platform points used up");
      const ledger = await db.usageLedger.create({
        data: {
          userId: ctx.userId, subscriptionId: ctx.subscriptionId, planId: ctx.plan.id ?? null, deviceId: meta.deviceId ?? null,
          modelId: model.modelId, endpoint: meta.endpoint, stream: meta.stream, status: "HELD", billing: "points",
          heldTwd: need, priceTwd: p, promptTokens: t.prompt, heldOutput: output,
        },
      });
      return { ledger, output };
    }
    const wk = (ctx.week = await weekBudget(ctx, now));
    const u = await windowUse(ctx.userId, now, wk.from);
    const promptCost = costTwd(p, { prompt: t.prompt, output: 0 });
    let output = t.output;
    if (meta.fit) {
      const free = Math.min(ctx.limits.l6 - u.w6, wk.availableTwd - u.w168) - promptCost;
      const affordable = p.output > 0 ? Math.floor((free * 1e6) / p.output) : output;
      output = Math.min(output, affordable);
      if (output < (t.minOutput ?? 1)) output = t.minOutput ?? 1; // fall through to the window check for a precise error
    }
    const need = promptCost + costTwd(p, { prompt: 0, output });
    const weekFull = u.w168 + need > wk.availableTwd + 1e-9;
    if (u.w6 + need > ctx.limits.l6 + 1e-9) {
      // when the week is full as well, room comes back only with next week's grant
      const retry = weekFull ? u.weekEndsAt : retryAt6(u.rows, ctx.limits.l6, u.w6, need);
      throw new QuotaError("6h", "6-hour quota used up", retry);
    }
    if (weekFull) throw new QuotaError("168h", "weekly quota used up (next grant Sunday 00:00 UTC)", u.weekEndsAt);
    const ledger = await db.usageLedger.create({
      data: {
        userId: ctx.userId, subscriptionId: ctx.subscriptionId, planId: ctx.plan.id, deviceId: meta.deviceId ?? null,
        modelId: model.modelId, endpoint: meta.endpoint, stream: meta.stream, status: "HELD",
        heldTwd: need, priceTwd: p, promptTokens: t.prompt, heldOutput: output,
      },
    });
    return { ledger, output };
  });
}

/** Reserve `tokens` more output for a running stream; false when it no longer fits (stop the stream) */
export async function topUp(ctx: QuotaCtx, ledgerId: string, tokens: number, counted: number): Promise<boolean> {
  return withUserLock(ctx.userId, async () => {
    const row = await db.usageLedger.findUnique({ where: { id: ledgerId } });
    if (!row || row.status !== "HELD") return false;
    const add = costTwd(row.priceTwd as Prices, { prompt: 0, output: tokens });
    const full =
      row.billing === "points"
        ? add > (await pointsAvailable(ctx.userId)) + 1e-9
        : await (async () => {
            const wk = ctx.week && ctx.week.weekEnd > new Date() ? ctx.week : (ctx.week = await weekBudget(ctx));
            const u = await windowUse(ctx.userId, new Date(), wk.from);
            return u.w6 + add > ctx.limits.l6 + 1e-9 || u.w168 + add > wk.availableTwd + 1e-9;
          })();
    if (full) {
      await db.usageLedger.update({ where: { id: ledgerId }, data: { countedOutput: counted } });
      return false;
    }
    await db.usageLedger.update({ where: { id: ledgerId }, data: { heldTwd: { increment: add }, heldOutput: { increment: tokens }, countedOutput: counted } });
    return true;
  });
}

export type Settlement =
  | { kind: "usage"; prompt: number; output: number; cacheRead?: number; cacheWrite?: number }
  | { kind: "estimate"; prompt: number; output: number; reason: string }
  | { kind: "refund"; reason: string };

/** Close a hold. Idempotent: only the first call on a HELD row counts. */
export async function settle(ledgerId: string, s: Settlement): Promise<UsageLedger | null> {
  const row = await db.usageLedger.findUnique({ where: { id: ledgerId } });
  if (!row || row.status !== "HELD") return row;
  const p = row.priceTwd as Prices;
  const data =
    s.kind === "refund"
      ? { status: "REFUNDED" as const, settledTwd: 0, error: s.reason.slice(0, 500) }
      : {
          status: s.kind === "usage" ? ("SETTLED" as const) : ("ESTIMATED" as const),
          // never more than was reserved: the windows can then never exceed L6 / L168 (an upstream count above our
          // estimate is absorbed by the platform)
          settledTwd: Math.min(costTwd(p, s), Number(row.heldTwd)),
          promptTokens: s.prompt,
          outputTokens: s.output,
          cacheReadTokens: s.kind === "usage" ? (s.cacheRead ?? 0) : 0,
          cacheWriteTokens: s.kind === "usage" ? (s.cacheWrite ?? 0) : 0,
          countedOutput: Math.max(row.countedOutput, s.kind === "estimate" ? s.output : 0),
          error: s.kind === "estimate" ? s.reason.slice(0, 500) : null,
        };
  const done = await db.usageLedger.updateMany({ where: { id: row.id, status: "HELD" }, data: { ...data, settledAt: new Date() } });
  if (done.count !== 1) return db.usageLedger.findUnique({ where: { id: row.id } });
  if (s.kind !== "refund" && s.output > 0) await recordOutput(row.userId, row.modelId, s.output);
  if (row.billing === "points" && s.kind !== "refund") await chargePoints(row.userId, row.id, row.modelId);
  return db.usageLedger.findUnique({ where: { id: row.id } });
}

async function recordOutput(userId: string, modelId: string, output: number) {
  const s = await db.userModelStats.findUnique({ where: { userId_modelId: { userId, modelId } } });
  if (!s) {
    await db.userModelStats.create({ data: { userId, modelId, avgOutput: output, count: 1 } }).catch(() => undefined);
    return;
  }
  const n = Math.min(s.count + 1, 50); // ≈ moving average over the last 50 calls
  await db.userModelStats.update({ where: { userId_modelId: { userId, modelId } }, data: { avgOutput: s.avgOutput + (output - s.avgOutput) / n, count: s.count + 1 } });
}

/** Holds nobody settled (crashed request, lost connection): settle at the hold after 10 minutes */
export async function sweepHolds(now = new Date()) {
  const stale = await db.usageLedger.findMany({ where: { status: "HELD", createdAt: { lt: new Date(now.getTime() - config.llm.holdTimeoutMs) } }, take: 500 });
  for (const r of stale) {
    const p = r.priceTwd as Prices;
    const counted = costTwd(p, { prompt: r.promptTokens, output: r.countedOutput });
    const done = await db.usageLedger.updateMany({
      where: { id: r.id, status: "HELD" },
      data: { status: "EXPIRED", settledTwd: Math.max(Number(r.heldTwd), counted), outputTokens: r.countedOutput, settledAt: now, error: "not settled within the hold timeout" },
    });
    if (done.count) await audit(null, "llm.hold.expired", { type: "usage", id: r.id }, { userId: r.userId, model: r.modelId, heldTwd: Number(r.heldTwd) });
    if (done.count && r.billing === "points") await chargePoints(r.userId, r.id, r.modelId);
  }
  return stale.length;
}

/**
 * Response headers for a finished (non-streamed) call: this call's share of the 6-hour limit and how full both
 * windows are now. SinoBee shows "占 6 小時額度 x%" under each answer from these.
 */
export async function quotaHeaders(ctx: QuotaCtx, row: Pick<UsageLedger, "userId" | "settledTwd" | "billing"> | null): Promise<Record<string, string>> {
  if (!row) return {};
  if (row.billing === "points") return { "x-sinobee-points": String(await pointBalance(row.userId)) };
  const wk = ctx.week ?? (await weekBudget(ctx));
  const u = await windowUse(row.userId, new Date(), wk.from);
  const pct = (v: number, limit: number) => (limit > 0 ? Math.min(100, (v / limit) * 100) : 100).toFixed(2);
  return {
    "x-sinobee-cost-6h-pct": pct(Number(row.settledTwd ?? 0), ctx.limits.l6),
    "x-sinobee-quota-6h": pct(u.w6, ctx.limits.l6),
    "x-sinobee-quota-168h": pct(u.w168, wk.availableTwd),
  };
}

// ───────────── platform points ─────────────

const sumTwd = (rows: { settledTwd: unknown }[]) => rows.reduce((a, r) => a + Number(r.settledTwd ?? 0), 0);

/** Points charged for model use so far (positive) and the settled TWD of all points calls */
async function pointsSpent(userId: string) {
  const charged = await db.pointLedger.aggregate({ where: { userId, reason: "llm_usage" }, _sum: { delta: true } });
  const rows = await db.usageLedger.findMany({ where: { userId, billing: "points", status: { not: "HELD" } }, select: { settledTwd: true } });
  return { charged: -(charged._sum.delta ?? 0), settled: sumTwd(rows) };
}

/** Points that can still be spent on model calls: the balance less running holds, plus the unused part of the last
 * whole point booked (the running total is rounded up) or less a part not booked yet */
export async function pointsAvailable(userId: string): Promise<number> {
  const [balance, held, s] = await Promise.all([
    pointBalance(userId),
    db.usageLedger.findMany({ where: { userId, billing: "points", status: "HELD" }, select: { heldTwd: true } }),
    pointsSpent(userId),
  ]);
  const pending = held.reduce((a, r) => a + Number(r.heldTwd), 0);
  return Math.max(0, balance - pending + (s.charged - s.settled));
}

/** Book the points a settled call used: 1:1 at the published TWD price, the running total rounded up to whole points */
export async function chargePoints(userId: string, ledgerId: string, modelId: string) {
  return withUserLock(userId, async () => {
    const s = await pointsSpent(userId);
    const due = Math.ceil(s.settled - 1e-9) - s.charged;
    if (due > 0) await bookPoints({ userId, delta: -due, reason: "llm_usage", ref: `llm:${ledgerId}`, note: modelId });
  });
}

// ───────────── status for the GUI (rings) ─────────────

export async function quotaStatus(userId: string, now = new Date()) {
  const ctx = await quotaContext(userId, now);
  const wk = await weekBudget(ctx, now);
  const u = await windowUse(userId, now, wk.from);
  const ref = await referenceBlended();
  const tokens = (twd: number) => (ref ? Math.floor((Math.max(0, twd) / ref.blendedTwd) * 1e6) : 0);
  type WindowView = {
    window: "6h" | "168h"; usedPct: number; remainingTokens: number; releases: { at: string; pct: number }[]; buckets?: number[];
    usedTwd: number; limitTwd?: number; resetsAt?: string; grantTwd?: number; carryInTwd?: number; capTwd?: number; availableTwd?: number;
  };
  const win = (key: "6h" | "168h", ms: number, limit: number, used: number): WindowView => {
    const usedPct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
    // 6 h: each cost frees up 6 h after it was incurred; the week: everything at the next Sunday 00:00 UTC
    const releases =
      key === "6h"
        ? u.rows
            .filter((r) => amount(r) > 0)
            .sort((a, b) => at(a).getTime() - at(b).getTime())
            .slice(0, 20)
            .map((r) => ({ at: new Date(at(r).getTime() + ms).toISOString(), pct: limit > 0 ? (amount(r) / limit) * 100 : 0 }))
        : [];
    // the 6 h window as 12 half-hour buckets (oldest first, % of the limit): SinoBee draws them as a timeline, and
    // the oldest bucket is the next to be released
    const buckets = key === "6h" ? Array.from({ length: 12 }, () => 0) : undefined;
    if (buckets && limit > 0) {
      const start = now.getTime() - ms;
      for (const r of u.rows) {
        const t = at(r).getTime();
        if (t <= start || amount(r) <= 0) continue;
        buckets[Math.min(11, Math.floor((t - start) / (ms / 12)))] += (amount(r) / limit) * 100;
      }
    }
    return {
      window: key,
      usedPct,
      remainingTokens: tokens(limit - used),
      // the week: next grant at resetsAt (Sunday 00:00:00 UTC); what is left now carries over while subscribed
      ...(key === "168h"
        ? { resetsAt: u.weekEndsAt.toISOString(), grantTwd: r2(wk.grantTwd), carryInTwd: r2(wk.carryInTwd), capTwd: r2(wk.capTwd), availableTwd: r2(wk.availableTwd), usedTwd: r2(used) }
        : { limitTwd: r2(limit), usedTwd: r2(used) }),
      releases,
      ...(buckets ? { buckets: buckets.map((b) => Math.round(b * 100) / 100) } : {}),
    };
  };
  const st = await subscriptionState(userId);
  const [balance, available] = await Promise.all([pointBalance(userId), pointsAvailable(userId)]);
  return {
    // platform points: shown on SinoBee's card and offered when the allowance runs out (1 point = NT$1, charged 1:1)
    points: { balance, available: Math.floor(available * 100) / 100, rate: 1, unit: "TWD" },
    plan: { code: ctx.plan.code, name: ctx.plan.name, nameEn: ctx.plan.nameEn, concurrency: ctx.plan.concurrency },
    endsAt: st.endsAt?.toISOString() ?? null,
    graceEndsAt: st.graceEndsAt?.toISOString() ?? null,
    level: ctx.level,
    windows: [win("6h", W6, ctx.limits.l6, u.w6), win("168h", W168, wk.availableTwd, u.w168)],
    inFlight: u.held,
    tokensBasis: ref ? { model: ref.model.modelId, label: ref.model.label, blendedTwdPer1M: ref.blendedTwd, mix: "input:output = 3:1" } : null,
  };
}

// ───────────── admin: reset a user's windows ─────────────

export const RESET_WINDOWS = ["6h", "week", "both"] as const;
export type ResetWindow = (typeof RESET_WINDOWS)[number];

/**
 * An admin gives one user a window back in full (support, an incident, goodwill): costs incurred up to now stop
 * counting in the 6 h window, the current week or both. Calls still running count when they settle. The weekly
 * schedule (Sunday 00:00 UTC) does not move. Audited as llm.quota.reset with the use it cleared.
 */
export async function resetWindows(actorId: string, userId: string, which: ResetWindow, reason?: string, now = new Date()) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!u) throw new HttpError(404, "user not found");
  return withUserLock(userId, async () => {
    const before = await windowUse(userId, now);
    await db.user.update({
      where: { id: userId },
      data: { ...(which !== "week" ? { quotaReset6hAt: now } : {}), ...(which !== "6h" ? { quotaResetWeekAt: now } : {}) },
    });
    const cleared = { w6Twd: which !== "week" ? round2(before.w6) : 0, w168Twd: which !== "6h" ? round2(before.w168) : 0 };
    await audit(actorId, "llm.quota.reset", { type: "user", id: userId }, { window: which, ...cleared, ...(reason?.trim() ? { reason: reason.trim().slice(0, 500) } : {}) });
    return { window: which, at: now.toISOString(), ...cleared };
  });
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const r2 = round2;
