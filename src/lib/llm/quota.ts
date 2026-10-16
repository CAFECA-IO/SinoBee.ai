import { db, dbKind } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { audit } from "../roles";
import { referenceBlended, type ModelPriceView } from "../models";
import { listPlans, type PlanView } from "../plans";
import { subscriptionState } from "../subscriptions";
import type { UsageLedger } from "@/generated/prisma/client";

/**
 * Subscription quota for the model relay (plan v6 §4).
 *
 *  hold     prompt tokens + expected output (stream: the user's average for the model, default 800;
 *           non-stream: the max_tokens we let through) at the published price, checked against both
 *           rolling windows (6 h ≤ L6, 168 h ≤ L168) in one locked step so concurrent calls cannot overshoot
 *  top-up   streams that outgrow the hold reserve another 256 output tokens; when that no longer fits the
 *           stream ends with finish_reason "quota"
 *  settle   from the upstream usage report as soon as the call ends (well within 2 s); without one, from
 *           our own count (ESTIMATED); upstream errors before any output refund the hold. The charge is capped at
 *           the hold, so the windows never exceed the plan limits
 *  sweep    holds older than 10 minutes are settled at the hold (EXPIRED) and logged
 *
 * Window membership: HELD rows count at heldTwd from createdAt; settled rows count at settledTwd from settledAt,
 * so quota frees up 6 h / 168 h after the moment the cost was incurred.
 */

export const W6 = 6 * 3600_000;
export const W168 = 168 * 3600_000;

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
  constructor(public window: "6h" | "168h" | "concurrency" | "rpm" | "subscription" | "provider", message: string, public retryAt?: Date) {
    super(window === "subscription" ? 402 : window === "provider" ? 503 : 429, message);
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

export type QuotaCtx = { userId: string; subscriptionId: string; plan: PlanView };

/** The caller's current subscription period and plan, or a 402 */
export async function quotaContext(userId: string): Promise<QuotaCtx> {
  const st = await subscriptionState(userId);
  if (!st.current) throw new QuotaError("subscription", "an active SinoBee.ai subscription is required (https://sinobee.ai/subscribe)");
  const plans = await listPlans();
  const plan = plans.find((p) => p.id === st.current!.planId) ?? plans.find((p) => p.code === st.current!.plan);
  if (!plan) throw new QuotaError("subscription", "subscription plan not found");
  return { userId, subscriptionId: st.current.id, plan };
}

type Row = Pick<UsageLedger, "status" | "heldTwd" | "settledTwd" | "createdAt" | "settledAt">;
const amount = (r: Row) => Number(r.status === "HELD" ? r.heldTwd : (r.settledTwd ?? 0));
const at = (r: Row) => (r.status === "HELD" ? r.createdAt : (r.settledAt ?? r.createdAt));

async function windowRows(userId: string, now: Date) {
  return db.usageLedger.findMany({
    where: { userId, OR: [{ status: "HELD" }, { settledAt: { gt: new Date(now.getTime() - W168) } }] },
    select: { status: true, heldTwd: true, settledTwd: true, createdAt: true, settledAt: true },
  });
}

export async function windowUse(userId: string, now = new Date()) {
  const rows = await windowRows(userId, now);
  let w6 = 0;
  let w168 = 0;
  let held = 0;
  for (const r of rows) {
    const a = amount(r);
    const t = at(r).getTime();
    if (r.status === "HELD") held++;
    if (r.status === "HELD" || t > now.getTime() - W168) w168 += a;
    if (r.status === "HELD" || t > now.getTime() - W6) w6 += a;
  }
  return { w6, w168, held, rows };
}

/** When enough settled cost leaves a window for `need` TWD to fit (for retry hints) */
function retryAt(rows: Row[], windowMs: number, limit: number, used: number, need: number, now: Date): Date | undefined {
  let excess = used + need - limit;
  const settled = rows.filter((r) => r.status !== "HELD" && at(r).getTime() > now.getTime() - windowMs).sort((a, b) => at(a).getTime() - at(b).getTime());
  for (const r of settled) {
    excess -= amount(r);
    if (excess <= 0) return new Date(at(r).getTime() + windowMs);
  }
  return undefined;
}

/** How much more (TWD) fits in both windows right now */
export async function headroom(ctx: QuotaCtx, now = new Date()) {
  const u = await windowUse(ctx.userId, now);
  return { ...u, free: Math.max(0, Math.min(ctx.plan.l6Twd - u.w6, ctx.plan.l168Twd - u.w168)) };
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
    const u = await windowUse(ctx.userId, now);
    if (u.held >= ctx.plan.concurrency) throw new QuotaError("concurrency", `at most ${ctx.plan.concurrency} requests at a time on this plan`);
    const p = model.twd;
    const promptCost = costTwd(p, { prompt: t.prompt, output: 0 });
    let output = t.output;
    if (meta.fit) {
      const free = Math.min(ctx.plan.l6Twd - u.w6, ctx.plan.l168Twd - u.w168) - promptCost;
      const affordable = p.output > 0 ? Math.floor((free * 1e6) / p.output) : output;
      output = Math.min(output, affordable);
      if (output < (t.minOutput ?? 1)) output = t.minOutput ?? 1; // fall through to the window check for a precise error
    }
    const need = promptCost + costTwd(p, { prompt: 0, output });
    if (u.w6 + need > ctx.plan.l6Twd + 1e-9)
      throw new QuotaError("6h", "6-hour quota used up", retryAt(u.rows, W6, ctx.plan.l6Twd, u.w6, need, now));
    if (u.w168 + need > ctx.plan.l168Twd + 1e-9)
      throw new QuotaError("168h", "7-day quota used up", retryAt(u.rows, W168, ctx.plan.l168Twd, u.w168, need, now));
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
    const u = await windowUse(ctx.userId);
    if (u.w6 + add > ctx.plan.l6Twd + 1e-9 || u.w168 + add > ctx.plan.l168Twd + 1e-9) {
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
  }
  return stale.length;
}

/**
 * Response headers for a finished (non-streamed) call: this call's share of the 6-hour limit and how full both
 * windows are now. SinoBee shows "占 6 小時額度 x%" under each answer from these.
 */
export async function quotaHeaders(plan: { l6Twd: number; l168Twd: number }, row: Pick<UsageLedger, "userId" | "settledTwd"> | null): Promise<Record<string, string>> {
  if (!row) return {};
  const u = await windowUse(row.userId);
  const pct = (v: number, limit: number) => (limit > 0 ? Math.min(100, (v / limit) * 100) : 100).toFixed(2);
  return {
    "x-sinobee-cost-6h-pct": pct(Number(row.settledTwd ?? 0), plan.l6Twd),
    "x-sinobee-quota-6h": pct(u.w6, plan.l6Twd),
    "x-sinobee-quota-168h": pct(u.w168, plan.l168Twd),
  };
}

// ───────────── status for the GUI (rings) ─────────────

export async function quotaStatus(userId: string, now = new Date()) {
  const ctx = await quotaContext(userId);
  const u = await windowUse(userId, now);
  const ref = await referenceBlended();
  const tokens = (twd: number) => (ref ? Math.floor((Math.max(0, twd) / ref.blendedTwd) * 1e6) : 0);
  const win = (key: "6h" | "168h", ms: number, limit: number, used: number) => {
    const releases = u.rows
      .filter((r) => r.status !== "HELD" && at(r).getTime() > now.getTime() - ms && amount(r) > 0)
      .sort((a, b) => at(a).getTime() - at(b).getTime())
      .slice(0, 20)
      .map((r) => ({ at: new Date(at(r).getTime() + ms).toISOString(), pct: limit > 0 ? (amount(r) / limit) * 100 : 0 }));
    return {
      window: key,
      usedPct: limit > 0 ? Math.min(100, (used / limit) * 100) : 100,
      remainingTokens: tokens(limit - used),
      releases,
    };
  };
  const st = await subscriptionState(userId);
  return {
    plan: { code: ctx.plan.code, name: ctx.plan.name, nameEn: ctx.plan.nameEn, concurrency: ctx.plan.concurrency },
    endsAt: st.endsAt?.toISOString() ?? null,
    graceEndsAt: st.graceEndsAt?.toISOString() ?? null,
    windows: [win("6h", W6, ctx.plan.l6Twd, u.w6), win("168h", W168, ctx.plan.l168Twd, u.w168)],
    inFlight: u.held,
    tokensBasis: ref ? { model: ref.model.modelId, label: ref.model.label, blendedTwdPer1M: ref.blendedTwd, mix: "input:output = 3:1" } : null,
  };
}
