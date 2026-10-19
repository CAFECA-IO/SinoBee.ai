import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import type { User } from "@/generated/prisma/client";

/**
 * Evaluations published from SinoBee (`sinobee eval publish`), scored with SFS v1.
 *
 * One report = one thing under test on one suite, graded by one judge, over n trials:
 *   kind "skill"  a skill used by a thinking + execution model combination
 *   kind "model"  one model doing everything (thinking = execution) on a domain's standard suite
 *
 * Every number is recomputed here from the trials' yes/no answers, never taken from the client:
 *   trial score Q  Σ category weight × share of its questions answered yes (out of 100); a failed critical question
 *                  caps it at 40; the trial qualifies when Q >= threshold (70) and no critical question failed
 *   fair score F   mean of the trial scores − their standard error (an unsteady or one-off result ranks lower)
 * And per subject (same skill or domain, same suite version, same judge) the four answers:
 *   fastest   median time of qualified trials        cheapest  total cost ÷ qualified trials
 *   quality   F                                      creativity  blind pairwise win rate (sinobee eval compare)
 * Only subjects with n >= 3 trials and at least 2/3 qualified compete. Speed and cost within 10% of the leader,
 * quality and creativity within twice the combined standard error, are reported as a tie.
 */

const grade = z.object({
  ok: z.boolean(),
  detail: z.string().max(400).default(""),
  evidence: z.string().max(400).nullish(),
  votes: z.array(z.number().int().nonnegative()).length(2).nullish(),
  judge2_ok: z.boolean().nullish(),
});
const step = z.object({
  step: z.number().int().nullish(),
  tokens: z.number().nonnegative().default(0),
  wall_s: z.number().nonnegative().default(0),
  retries: z.number().int().nonnegative().default(0),
  failed: z.boolean().default(false),
  produced: z.boolean().default(false),
});
const role = z.object({ input_tokens: z.number().nonnegative().default(0), output_tokens: z.number().nonnegative().default(0), cost_usd: z.number().nonnegative().default(0) });
const output = z.object({ path: z.string().max(300), kind: z.enum(["text", "image"]).default("text"), bytes: z.number().nonnegative().default(0), text: z.string().max(60_000).nullish() });
const trial = z.object({
  trial: z.number().int().positive(),
  run: z.string().max(120).nullish(),
  status: z.string().max(40).nullish(),
  started: z.number().nullish(),
  duration_s: z.number().nonnegative().default(0),
  cost_usd: z.number().nonnegative().default(0),
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  steps: z.number().nonnegative().default(0),
  tool_calls: z.number().nonnegative().default(0),
  roles: z.object({ thinking: role.optional(), execution: role.optional() }).partial().default({}),
  steps_trace: z.array(step).max(200).default([]),
  error: z.string().max(1000).nullish(),
  grades: z.array(grade).max(60),
  answer: z.string().max(2000).default(""),
  outputs: z.array(output).max(20).default([]),
});
const OWNERS = ["skill", "thinking", "execution"] as const;
const STAGES = ["plan", "exec", "review", "output"] as const;
const question = z.object({
  label: z.string().min(1).max(200),
  category: z.string().min(1).max(60),
  kind: z.enum(["det", "judge"]),
  critical: z.boolean().default(false),
  owner: z.enum(OWNERS).default("execution"),
  stage: z.enum(STAGES).default("output"),
});
const task = z.object({
  id: z.string().min(1).max(120),
  title: z.string().max(200),
  prompt: z.string().max(4000).default(""),
  questions: z.array(question).min(1).max(60),
  weights: z.record(z.string(), z.number().nonnegative()).default({}),
  trials: z.array(trial).min(1).max(20),
});
export const evalInput = z.object({
  kind: z.enum(["skill", "model"]),
  subject: z.string().min(1).max(120),
  subject_version: z.string().max(40).default(""),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).default(""),
  suite: z.string().min(1).max(200),
  suite_hash: z.string().min(8).max(128),
  input_hash: z.string().max(128).nullish(),
  thinking: z.string().min(1).max(120),
  execution: z.string().min(1).max(120),
  judge: z.string().min(1).max(120),
  judge2: z.string().max(120).nullish(),
  judge2_agree: z.array(z.number().int().nonnegative()).length(2).nullish(),
  judge_check: z.object({ total: z.number().int().nonnegative(), correct: z.number().int().nonnegative() }).nullish(),
  threshold: z.number().min(0).max(100).default(70),
  client_version: z.string().max(40).nullish(),
  tested_at: z.number().positive(),
  tested_until: z.number().nonnegative().nullish(),
  runs: z.array(z.string().max(120)).max(50).default([]),
  tasks: z.array(task).min(1).max(20),
  creativity: z.object({ wins: z.number().int().nonnegative(), total: z.number().int().nonnegative(), judge: z.string().max(120).nullish(), combos: z.number().int().nullish() }).nullish(),
});
export type EvalInput = z.infer<typeof evalInput>;
export type EvalTask = z.infer<typeof task>;
export type EvalTrial = z.infer<typeof trial>;
export type EvalQuestion = z.infer<typeof question>;

export const CRIT_CAP = 40;
export const MIN_TRIALS = 3;

/** Category weights of a task: the suite's, else every category weighs the same */
export function weightsOf(t: Pick<EvalTask, "questions" | "weights">): Record<string, number> {
  const cats = [...new Set(t.questions.map((q) => q.category))];
  const given = Object.keys(t.weights ?? {}).length > 0;
  return Object.fromEntries(cats.map((c) => [c, given ? (t.weights[c] ?? 0) : 1]));
}

/** SFS v1 trial score from the yes/no answers */
export function trialScore(t: Pick<EvalTask, "questions" | "weights">, oks: boolean[], threshold = 70) {
  const w = weightsOf(t);
  const total = Object.values(w).reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
  let q = 0;
  for (const [cat, wt] of Object.entries(w)) {
    const idx = t.questions.map((x, i) => (x.category === cat ? i : -1)).filter((i) => i >= 0);
    if (idx.length && wt > 0) q += (wt * idx.filter((i) => oks[i]).length) / idx.length;
  }
  q = (100 * q) / total;
  const critFail = t.questions.some((x, i) => x.critical && !oks[i]);
  if (critFail) q = Math.min(q, CRIT_CAP);
  q = Math.round(q * 100) / 100;
  return { q, critFail, qualified: q >= threshold && !critFail };
}

export function categoryRates(t: Pick<EvalTask, "questions" | "weights">, oks: boolean[]) {
  const w = weightsOf(t);
  return Object.entries(w).map(([name, weight]) => {
    const idx = t.questions.map((x, i) => (x.category === name ? i : -1)).filter((i) => i >= 0);
    return { name, weight, passed: idx.filter((i) => oks[i]).length, total: idx.length };
  });
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function fair(qs: number[]) {
  const n = qs.length;
  const m = mean(qs);
  const sd = n > 1 ? Math.sqrt(qs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)) : 0;
  const se = n ? sd / Math.sqrt(n) : 0;
  return { n, mean: m, se, fair: m - se };
}
export function median(a: number[]) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Everything a report's numbers rest on, from its trials */
export function reportStats(r: Pick<EvalInput, "tasks" | "threshold">) {
  const scored = r.tasks.map((t) => ({ task: t, trials: t.trials.map((x) => ({ x, ...trialScore(t, x.grades.map((g) => g.ok), r.threshold) })) }));
  const k = Math.min(...scored.map((s) => s.trials.length));
  // trial i over the suite: the mean of every task's i-th trial (tasks weigh the same)
  const trialQ = Array.from({ length: k }, (_, i) => mean(scored.map((s) => s.trials[i].q)));
  const all = scored.flatMap((s) => s.trials);
  const ok = all.filter((t) => t.qualified);
  const f = fair(trialQ);
  const cost = all.reduce((a, t) => a + t.x.cost_usd, 0);
  const durations = ok.map((t) => t.x.duration_s);
  return {
    n: k, trialQ, mean: f.mean, se: f.se, fair: f.fair,
    observations: all.length, qualified: ok.length, critFails: all.filter((t) => t.critFail).length,
    medianSeconds: median(durations), p90Seconds: durations.length ? Math.max(...durations) : null,
    costPerPass: ok.length ? cost / ok.length : null, totalCost: cost,
    tokens: all.reduce((a, t) => a + t.x.input_tokens + t.x.output_tokens, 0) / (all.length || 1),
    scored,
  };
}

/** claude | gemini | gpt | gemma | … */
export function family(model: string | null | undefined) {
  const m = (model ?? "").toLowerCase().split("/").pop() ?? "";
  for (const f of ["claude", "gemini", "gpt", "gemma", "llama", "qwen", "mistral", "deepseek", "grok"]) if (m.includes(f)) return f;
  return m.split(/[-:]/)[0];
}
/** the judge shares a family with a model under test (its own blind spots) */
export const sameFamily = (judge: string, thinking: string, execution: string) => family(judge) === family(thinking) || family(judge) === family(execution);

export type Verdict = "done" | "partial" | "failed";
export function verdict(meanScore: number, critFails: number, observations: number): Verdict {
  if (critFails > 0 && critFails / (observations || 1) > 1 / 3) return meanScore >= 60 ? "partial" : "failed";
  if (critFails > 0) return "partial";
  return meanScore >= 80 ? "done" : meanScore >= 60 ? "partial" : "failed";
}

// ---------------------------------------------------------------- subject board (the four answers)

export type BoardRow = {
  id: number; kind: string; thinkingModel: string; executionModel: string; trials: number; meanScore: number; stdErr: number;
  fairScore: number; qualified: number; critFails: number; medianSeconds: number | null; p90Seconds: number | null;
  costPerPass: number | null; creativityWins: number | null; creativityTotal: number | null; testedAt: Date; observations: number;
};
export type Contender = BoardRow & {
  rate: number; eligible: boolean; out: null | "trial" | "critical" | "rate"; creativity: number | null; creativitySe: number;
  norm: { speed: number; cost: number; quality: number; creativity: number };
};
export const AXES = ["speed", "cost", "quality", "creativity"] as const;
export type Axis = (typeof AXES)[number];
export type Award = { axis: Axis; rank: Contender[]; winner: Contender | null; runnerUp: Contender | null; tied: Contender[] };

const lowBetter: Record<Axis, boolean> = { speed: true, cost: true, quality: false, creativity: false };
export function axisValue(c: Contender, a: Axis): number | null {
  return a === "speed" ? c.medianSeconds : a === "cost" ? c.costPerPass : a === "quality" ? c.fairScore : c.creativity;
}
function isTie(a: Axis, w: Contender, c: Contender) {
  if (a === "speed") return (c.medianSeconds ?? Infinity) / (w.medianSeconds ?? 1) < 1.1;
  if (a === "cost") return (w.costPerPass ?? 0) === 0 ? (c.costPerPass ?? 1) === 0 : (c.costPerPass ?? Infinity) / (w.costPerPass ?? 1) < 1.1;
  if (a === "quality") return Math.abs(w.meanScore - c.meanScore) < 2 * Math.hypot(w.stdErr, c.stdErr);
  return (w.creativity ?? 0) - (c.creativity ?? 0) < 2 * Math.hypot(w.creativitySe, c.creativitySe);
}

/** The four answers, the most balanced and the best value among the reports of one subject */
export function board(rows: BoardRow[]) {
  const cs: Contender[] = rows.map((r) => {
    const rate = r.qualified / (r.observations || 1);
    const crea = r.creativityTotal ? (r.creativityWins ?? 0) / r.creativityTotal : null;
    const out = r.trials < MIN_TRIALS ? "trial" : r.critFails / (r.observations || 1) > 1 / 3 ? "critical" : rate < 2 / 3 ? "rate" : null;
    return { ...r, rate, eligible: !out, out, creativity: crea, creativitySe: crea === null ? 0 : Math.sqrt((crea * (1 - crea)) / (r.creativityTotal || 1)), norm: { speed: 0, cost: 0, quality: Math.max(0, r.fairScore), creativity: 0 } };
  });
  const E = cs.filter((c) => c.eligible);
  const minS = Math.min(...E.map((c) => c.medianSeconds ?? Infinity));
  const minC = Math.min(...E.map((c) => c.costPerPass ?? Infinity));
  for (const c of E) {
    c.norm = {
      speed: c.medianSeconds ? (100 * minS) / c.medianSeconds : 0,
      // a cent added on both sides: a free local model must not turn every paid one into 0
      cost: c.costPerPass === null ? 0 : (100 * (minC + 0.01)) / (c.costPerPass + 0.01),
      quality: Math.max(0, c.fairScore),
      creativity: c.creativity === null ? 0 : 100 * c.creativity,
    };
  }
  const awards: Award[] = AXES.map((axis) => {
    const has = E.filter((c) => axisValue(c, axis) !== null);
    const rank = [...has].sort((x, y) => (lowBetter[axis] ? axisValue(x, axis)! - axisValue(y, axis)! : axisValue(y, axis)! - axisValue(x, axis)!));
    const winner = rank[0] ?? null;
    return { axis, rank, winner, runnerUp: rank[1] ?? null, tied: winner ? rank.slice(1).filter((c) => isTie(axis, winner, c)) : [] };
  });
  // the weakest of its axes (creativity counts once a comparison was run)
  const weakest = (c: Contender) => Math.min(c.norm.speed, c.norm.cost, c.norm.quality, c.creativity === null ? Infinity : c.norm.creativity);
  const balanced = [...E].sort((a, b) => weakest(b) - weakest(a))[0] ?? null;
  const qBest = awards[2].winner;
  const value = qBest ? E.filter((c) => c.meanScore >= qBest.meanScore - 5 && c.costPerPass !== null).sort((a, b) => a.costPerPass! - b.costPerPass!)[0] ?? qBest : null;
  return { contenders: cs, eligible: E, awards, balanced, value, weakest };
}

// ---------------------------------------------------------------- publishing

export async function createEval(user: Pick<User, "id">, raw: unknown) {
  const r = evalInput.parse(raw);
  if (r.kind === "model" && r.thinking !== r.execution) throw new HttpError(400, "a model evaluation has one model (thinking = execution)");
  for (const t of r.tasks) {
    for (const x of t.trials) if (x.grades.length !== t.questions.length) throw new HttpError(400, `task ${t.id}: every trial answers each question once`);
  }
  if (new Set(r.tasks.map((t) => t.trials.length)).size > 1) throw new HttpError(400, "every task has the same number of trials");
  const s = reportStats(r);
  const { scored: _scored, ...stats } = s;
  void _scored;
  return db.benchEval.create({
    data: {
      publisherId: user.id, kind: r.kind, subject: r.subject, subjectVersion: r.subject_version, title: r.title, summary: r.summary,
      suite: r.suite, suiteHash: r.suite_hash, inputHash: r.input_hash ?? null, thinkingModel: r.thinking, executionModel: r.execution,
      judgeModel: r.judge, judge2Model: r.judge2 ?? null, clientVersion: r.client_version ?? null,
      testedAt: new Date(r.tested_at * 1000), testedUntil: r.tested_until ? new Date(r.tested_until * 1000) : null,
      trials: stats.n,
      data: { tasks: r.tasks, threshold: r.threshold, judgeCheck: r.judge_check ?? null, judge2Agree: r.judge2_agree ?? null, creativity: r.creativity ?? null, runs: r.runs, observations: stats.observations, trialQ: stats.trialQ } as object,
      meanScore: stats.mean, stdErr: stats.se, fairScore: stats.fair, qualified: stats.qualified, critFails: stats.critFails,
      medianSeconds: stats.medianSeconds, p90Seconds: stats.p90Seconds, costPerPass: stats.costPerPass,
      creativityWins: r.creativity?.wins ?? null, creativityTotal: r.creativity?.total ?? null,
    },
  });
}

export const LIST_SELECT = {
  id: true, kind: true, subject: true, subjectVersion: true, suite: true, suiteHash: true, title: true, thinkingModel: true, executionModel: true,
  judgeModel: true, trials: true, meanScore: true, stdErr: true, fairScore: true, qualified: true, critFails: true, medianSeconds: true,
  p90Seconds: true, costPerPass: true, creativityWins: true, creativityTotal: true, testedAt: true, data: true,
  publisher: { select: { publisher: true, handle: true, account: true } },
} as const;

export type ListRow = BoardRow & {
  subject: string; subjectVersion: string; suite: string; suiteHash: string; title: string; judgeModel: string;
  publisherName: string;
};

export function toBoardRow(r: { data: unknown } & Omit<BoardRow, "observations">): BoardRow {
  const d = r.data as { observations?: number };
  return { id: r.id, kind: r.kind, thinkingModel: r.thinkingModel, executionModel: r.executionModel, trials: r.trials, meanScore: r.meanScore, stdErr: r.stdErr,
    fairScore: r.fairScore, qualified: r.qualified, critFails: r.critFails, medianSeconds: r.medianSeconds, p90Seconds: r.p90Seconds, costPerPass: r.costPerPass,
    creativityWins: r.creativityWins, creativityTotal: r.creativityTotal, testedAt: r.testedAt, observations: d?.observations ?? r.trials };
}

/** The reports of a subject that can be compared: same suite version and judge as the newest; the newest report per subject under test */
export function comparable<T extends { suiteHash: string; judgeModel: string; thinkingModel: string; executionModel: string; testedAt: Date }>(rows: T[]) {
  const newest = [...rows].sort((a, b) => +b.testedAt - +a.testedAt);
  const ref = newest[0];
  if (!ref) return { set: [] as T[], other: [] as T[] };
  const seen = new Set<string>();
  const set: T[] = [];
  const other: T[] = [];
  for (const r of newest) {
    const k = `${r.thinkingModel}|${r.executionModel}`;
    if (r.suiteHash === ref.suiteHash && r.judgeModel === ref.judgeModel && !seen.has(k)) {
      seen.add(k);
      set.push(r);
    } else other.push(r);
  }
  return { set, other };
}
