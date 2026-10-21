import { db } from "../db";
import { HttpError } from "../errors";
import { config } from "../config";
import { currentModels, type ModelPriceView } from "../models";
import { quotaContext, headroom } from "./quota";
import { downVendors } from "./breaker";

/**
 * Model allocation for SinoBee (plan "模型分配與備援機制" P4/P5, 2026-10-21).
 *
 * SinoBee asks once per turn and role which model to use. The answer weighs, per candidate:
 *   quality  the model's fair score in public SinoBee.ai evaluations - of this skill when there are some, else of all
 *            its evaluations, else a prior from its price; scaled by the completion rate users reported for this kind
 *            of task (P5, only from users who turned "回報匿名統計" on; at least 10 reports)
 *   cost     published TWD price (input:output = 3:1) for relay models; the evaluations' cost per pass otherwise
 *   speed    median seconds in the evaluations, else the relay's own median call time over the last day
 *   health   the relay's error rate over the last 15 minutes: half or more of at least 4 calls failing removes a
 *            vendor; a fifth or more is a penalty
 * by the user's preference (speed | quality | cost | balanced) and the role (thinking leans to quality; summary and
 * review to cost); when less than a fifth of the 6-hour allowance is left, cost counts more.
 *
 * A pinned model never gets here: SinoBee does not ask while the user has locked a model.
 * Nothing about the request is stored: only POST /api/v1/llm/stats (opt-in) writes RouteStat rows.
 */

export const PREFERENCES = ["speed", "quality", "cost", "balanced"] as const;
export type Preference = (typeof PREFERENCES)[number];
export const ROLES = ["main", "thinking", "summary", "review", "embed"] as const;
export type Role = (typeof ROLES)[number];
export const TASK_KINDS = ["chat", "page", "code", "research", "data", "other"] as const;

const WEIGHTS: Record<Preference, { q: number; c: number; s: number }> = {
  quality: { q: 0.7, c: 0.15, s: 0.15 },
  speed: { q: 0.25, c: 0.15, s: 0.6 },
  cost: { q: 0.25, c: 0.6, s: 0.15 },
  balanced: { q: 0.45, c: 0.3, s: 0.25 },
};

export type RouteRequest = {
  role?: Role;
  preference?: Preference;
  skill?: string | null;
  task_kind?: string | null;
  needs?: { tools?: boolean; vision?: boolean; context_tokens?: number };
  /** the user's own models ("vendor/model"): rank these instead of the relay's (the fallback pool) */
  candidates?: string[];
  /** models that just failed for this caller: left out (SinoBee asks again after a vendor failure) */
  exclude?: string[];
};

export type Ranked = {
  model: string;
  score: number;
  quality: number;
  qualitySource: "skill" | "evaluations" | "price";
  costTwdPer1M: number | null;
  costPerPass: number | null;
  seconds: number | null;
  completion: number | null;
  reports: number;
  evals: number;
  health: "ok" | "degraded" | "down";
};

const norm = (m: string) => m.replace(/^sinobee\//, "").toLowerCase();
const blended = (m: ModelPriceView) => (3 * m.twd.input + m.twd.output) / 4;
const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Models the relay can call now (a key for the vendor), embeddings apart */
async function relayModels(embed: boolean) {
  return (await currentModels()).filter((m) => {
    const p = config.llm.providers[m.modelId.split("/")[0]];
    return p?.key && /embed/i.test(m.modelId) === embed;
  });
}

/** Rough capability table: which models read images (no catalog field yet) */
function sees(model: string) {
  return /claude|gpt-4o|gpt-4\.1|gpt-5|gemini|vision|vl\b|llava/i.test(model);
}

async function evalFacts(models: string[], skill?: string | null) {
  const rows = await db.benchEval.findMany({
    where: { hidden: false, visibility: "public" },
    select: { subject: true, kind: true, executionModel: true, fairScore: true, costPerPass: true, medianSeconds: true, trials: true },
  });
  const out = new Map<string, { skill: number[]; all: number[]; cost: number[]; secs: number[]; n: number }>();
  for (const m of models) out.set(m, { skill: [], all: [], cost: [], secs: [], n: 0 });
  for (const r of rows) {
    const f = out.get(norm(r.executionModel));
    if (!f || r.trials < 1) continue;
    f.n++;
    f.all.push(r.fairScore);
    if (skill && r.kind === "skill" && r.subject === skill) f.skill.push(r.fairScore);
    if (r.costPerPass != null) f.cost.push(r.costPerPass);
    if (r.medianSeconds != null) f.secs.push(r.medianSeconds);
  }
  return out;
}

/** Completion rate users reported (P5): done / all, per model, for this kind of task when there are enough */
async function reported(models: string[], taskKind: string) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const rows = await db.routeStat.findMany({ where: { modelId: { in: models }, day: { gte: since } }, select: { modelId: true, taskKind: true, outcome: true } });
  const out = new Map<string, { rate: number | null; n: number }>();
  for (const m of models) {
    const mine = rows.filter((r) => r.modelId === m);
    const same = mine.filter((r) => r.taskKind === taskKind);
    const use = same.length >= 10 ? same : mine;
    out.set(m, { rate: use.length >= 10 ? use.filter((r) => r.outcome === "done").length / use.length : null, n: use.length });
  }
  return out;
}

/** The relay's own record over the last 15 minutes (errors) and the last day (call time) */
async function relayHealth(models: string[]) {
  const now = Date.now();
  const rows = await db.usageLedger.findMany({
    where: { modelId: { in: models }, createdAt: { gt: new Date(now - 86400_000) }, status: { not: "HELD" } },
    select: { modelId: true, status: true, error: true, createdAt: true, settledAt: true },
  });
  const out = new Map<string, { health: Ranked["health"]; seconds: number | null }>();
  for (const m of models) {
    const mine = rows.filter((r) => r.modelId === m);
    const recent = mine.filter((r) => r.createdAt.getTime() > now - 15 * 60_000);
    const bad = recent.filter((r) => r.status === "REFUNDED" && /upstream/i.test(r.error ?? "")).length;
    const health = recent.length >= 4 && bad / recent.length >= 0.5 ? "down" : recent.length >= 4 && bad / recent.length >= 0.2 ? "degraded" : "ok";
    const secs = mine.filter((r) => r.status === "SETTLED" && r.settledAt).map((r) => (r.settledAt!.getTime() - r.createdAt.getTime()) / 1000);
    out.set(m, { health, seconds: median(secs) });
  }
  return out;
}

/** Rank candidates for one request. userId: for the allowance left (relay candidates only). */
export async function rank(req: RouteRequest, userId?: string): Promise<{ ranked: Ranked[]; weights: { q: number; c: number; s: number }; pool: "relay" | "own" }> {
  const role: Role = ROLES.includes(req.role as Role) ? (req.role as Role) : "main";
  const pref: Preference = PREFERENCES.includes(req.preference as Preference) ? (req.preference as Preference) : "balanced";
  const kind = TASK_KINDS.includes(req.task_kind as (typeof TASK_KINDS)[number]) ? (req.task_kind as string) : "other";
  const own = Array.isArray(req.candidates) && req.candidates.length > 0;
  const catalog = await relayModels(role === "embed");
  const byId = new Map((await currentModels()).map((m) => [m.modelId.toLowerCase(), m]));
  let models = own ? [...new Set(req.candidates!.map((c) => norm(String(c))).filter(Boolean))].slice(0, 30) : catalog.map((m) => m.modelId.toLowerCase());
  if (req.needs?.vision) models = models.filter(sees);
  if (Array.isArray(req.exclude) && req.exclude.length) {
    const ex = new Set(req.exclude.map((x) => norm(String(x))));
    models = models.filter((m) => !ex.has(m));
  }
  if (!own) {
    const down = await downVendors();                       // hard failures: the vendor is out for 30 minutes
    models = models.filter((m) => !down.has(m.split("/")[0]));
  }
  if (!models.length) throw new HttpError(404, "no model fits this request");

  const w = { ...WEIGHTS[pref] };
  if (role === "thinking") (w.q += 0.15), (w.c -= 0.1), (w.s -= 0.05);
  if (role === "summary" || role === "review") (w.c += 0.15), (w.q -= 0.1), (w.s -= 0.05);
  if (!own && userId) {
    try {
      const ctx = await quotaContext(userId);
      const h = await headroom(ctx);
      if (ctx.plan.l6Twd > 0 && h.free < ctx.plan.l6Twd * 0.2) (w.c += 0.2), (w.q -= 0.15), (w.s -= 0.05);
    } catch {
      /* no subscription: points or the free plan decide elsewhere */
    }
  }

  const [facts, reports, health] = await Promise.all([evalFacts(models, req.skill), reported(models, kind), relayHealth(models)]);
  const prices = models.map((m) => byId.get(m)).filter(Boolean).map((m) => blended(m!));
  const midPrice = median(prices) ?? 100;
  const rows: Ranked[] = models.map((m) => {
    const f = facts.get(m)!;
    const price = byId.get(m) ? blended(byId.get(m)!) : null;
    const prior = price != null ? Math.max(30, Math.min(90, 60 + 25 * Math.log10(price / midPrice))) : 50;
    const quality = f.skill.length ? median(f.skill)! : f.all.length ? median(f.all)! : prior;
    const rep = reports.get(m)!;
    const h = health.get(m)!;
    return {
      model: m, score: 0, quality: rep.rate == null ? quality : quality * (0.7 + 0.3 * rep.rate),
      qualitySource: f.skill.length ? "skill" : f.all.length ? "evaluations" : "price",
      costTwdPer1M: price, costPerPass: median(f.cost), seconds: median(f.secs) ?? h.seconds,
      completion: rep.rate, reports: rep.n, evals: f.n, health: h.health,
    };
  });
  const live = rows.filter((r) => r.health !== "down");
  const use = live.length ? live : rows;
  // cost: the relay's price when there is one, else the evaluations' cost per pass (TWD per pass ≈ comparable order)
  const costOf = (r: Ranked) => r.costTwdPer1M ?? (r.costPerPass != null ? r.costPerPass * 32.5 * 10 : null);
  const minC = Math.min(...use.map(costOf).filter((v): v is number => v != null && v > 0), Infinity);
  const minS = Math.min(...use.map((r) => r.seconds).filter((v): v is number => v != null && v > 0), Infinity);
  for (const r of use) {
    const c = costOf(r);
    const cN = c == null ? 50 : c <= 0 ? 100 : (100 * (minC === Infinity ? c : minC)) / c;
    const sN = r.seconds == null || minS === Infinity ? 50 : (100 * minS) / r.seconds;
    r.score = w.q * r.quality + w.c * cN + w.s * sN - (r.health === "degraded" ? 15 : 0);
    r.score = Math.round(r.score * 100) / 100;
  }
  use.sort((a, b) => b.score - a.score);
  return { ranked: use, weights: w, pool: own ? "own" : "relay" };
}

/** The pick and a short reason for SinoBee's "由 SinoBee.ai 分配" line */
export async function route(req: RouteRequest, userId?: string) {
  const { ranked, weights, pool } = await rank(req, userId);
  const best = ranked[0];
  const pref = PREFERENCES.includes(req.preference as Preference) ? req.preference : "balanced";
  const why =
    best.qualitySource === "skill" && pref !== "cost" && pref !== "speed"
      ? "此技能評鑑成績最佳"
      : pref === "speed"
        ? "偏好速度：最快的可靠模型"
        : pref === "cost"
          ? "偏好成本：最省的可靠模型"
          : pref === "quality"
            ? "偏好品質：評鑑分數最高"
            : "品質與成本最平衡";
  const fmt = config.llm.providers[best.model.split("/")[0]]?.kind ?? null;
  return {
    model: best.model,
    format: pool === "relay" ? fmt : null,
    reason: why + (best.health === "degraded" ? "（服務略不穩）" : ""),
    preference: pref,
    ttl: 600,
    weights,
    ranking: ranked.slice(0, 6),
  };
}

/** For SinoBee's settings: each model's facts and which preference would pick it */
export async function boardFor(models: string[], skill?: string | null) {
  const picks: Record<string, string[]> = {};
  const facts = await rank({ candidates: models, preference: "balanced", skill });
  for (const p of PREFERENCES) {
    const r = await rank({ candidates: models, preference: p, skill });
    (picks[r.ranked[0].model] ??= []).push(p);
  }
  return facts.ranked.map((r) => ({ ...r, picks: picks[r.model] ?? [] }));
}

// ───────────── P5: anonymous outcomes (opt-in in SinoBee) ─────────────

const OUTCOMES = ["done", "incomplete", "failed", "stopped"];

/** Store reported outcomes without the user: day, model, kind of task, a published skill name, numbers. */
export async function recordStats(items: unknown) {
  if (!Array.isArray(items)) throw new HttpError(400, "items must be a list");
  if (items.length > 50) throw new HttpError(413, "at most 50 items per call");
  const day = new Date().toISOString().slice(0, 10);
  const skills = new Set(
    (await db.skill.findMany({ where: { name: { in: items.map((i) => String((i as { skill?: unknown })?.skill ?? "")).filter(Boolean) } }, select: { name: true } })).map((s) => s.name),
  );
  const num = (v: unknown, max: number) => Math.max(0, Math.min(max, Number(v) || 0));
  const data = items
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.model === "string" && OUTCOMES.includes(String(x.outcome)))
    .map((x) => ({
      day,
      modelId: norm(String(x.model)).slice(0, 120),
      taskKind: TASK_KINDS.includes(x.task_kind as (typeof TASK_KINDS)[number]) ? String(x.task_kind) : "other",
      skill: typeof x.skill === "string" && skills.has(x.skill) ? x.skill : null,
      outcome: String(x.outcome),
      seconds: num(x.seconds, 86400),
      tokensIn: Math.round(num(x.tokens_in, 1e9)),
      tokensOut: Math.round(num(x.tokens_out, 1e9)),
      retries: Math.round(num(x.retries, 1000)),
      cutOff: x.cut_off === true,
    }));
  if (data.length) await db.routeStat.createMany({ data });
  return { stored: data.length };
}
