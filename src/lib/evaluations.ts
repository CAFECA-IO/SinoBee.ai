import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import type { User } from "@/generated/prisma/client";

/**
 * Evaluation studies: model / skill evaluations run in SinoBee and published with `sinobee eval publish`.
 * One study compares models on the same tasks, graded by one judge model; every number comes from the runs.
 */

const grade = z.object({ label: z.string().max(200), ok: z.boolean(), detail: z.string().max(400).default("") });
const trial = z.object({
  trial: z.number().int().nullish(),
  passed: z.boolean(),
  status: z.string().max(40).nullish(),
  steps: z.number().nullish(),
  tool_calls: z.number().nullish(),
  duration_s: z.number().nonnegative().nullish(),
  input_tokens: z.number().int().nonnegative().nullish(),
  output_tokens: z.number().int().nonnegative().nullish(),
  cache_read_tokens: z.number().int().nonnegative().nullish(),
  cost_usd: z.number().nonnegative().nullish(),
  started: z.number().nullish(),
  error: z.string().max(1000).nullish(),
  grades: z.array(grade).max(40),
  answer: z.string().max(2000).default(""),
  files: z.array(z.string().max(300)).max(30).default([]),
});
const task = z.object({
  id: z.string().max(120),
  title: z.string().max(200),
  prompt: z.string().max(4000).default(""),
  graders: z.array(z.string().max(200)).max(40).default([]),
  pass_at_k: z.boolean().nullish(),
  pass_hat_k: z.boolean().nullish(),
  trials: z.array(trial).min(1).max(10),
});
const run = z.object({
  model: z.string().min(1).max(120),
  solo: z.boolean().default(false),
  run_id: z.string().max(120).nullish(),
  k: z.number().int().nullish(),
  started: z.number().nullish(),
  finished: z.number().nullish(),
  totals: z.record(z.string(), z.number()).default({}),
  judge_usage: z.record(z.string(), z.number()).default({}),
  tasks: z.array(task).min(1).max(50),
});
export const studyInput = z.object({
  kind: z.enum(["model", "skill"]),
  title: z.string().min(1).max(200),
  domain: z.string().max(120).default(""),
  skill: z.string().max(120).nullish(),
  summary: z.string().max(2000).default(""),
  body: z.string().max(100_000).default(""),
  suite: z.string().min(1).max(200),
  judge: z.string().max(120).nullish(),
  client_version: z.string().max(40).nullish(),
  tested_at: z.number().positive(),
  tested_until: z.number().nonnegative().nullish(),
  runs: z.array(run).min(1).max(12),
});
export type StudyInput = z.infer<typeof studyInput>;
export type StudyRun = z.infer<typeof run>;

/** What a run did, from its trials (not from client-side totals): score, pass rates, time and tokens */
export function runStats(r: StudyRun) {
  const trials = r.tasks.flatMap((t) => t.trials);
  const n = trials.length || 1;
  const score = (100 * trials.reduce((a, t) => a + t.grades.filter((g) => g.ok).length / (t.grades.length || 1), 0)) / n;
  const sum = (f: (t: (typeof trials)[number]) => number | null | undefined) => trials.reduce((a, t) => a + (f(t) ?? 0), 0);
  return {
    score: Math.round(score * 10) / 10,
    tasks: r.tasks.length,
    trials: trials.length,
    passAtK: r.tasks.filter((t) => t.trials.some((x) => x.passed)).length,
    passHatK: r.tasks.filter((t) => t.trials.every((x) => x.passed)).length,
    trialPass: trials.filter((t) => t.passed).length,
    durationS: sum((t) => t.duration_s),
    avgDurationS: sum((t) => t.duration_s) / n,
    inputTokens: sum((t) => t.input_tokens),
    outputTokens: sum((t) => t.output_tokens),
    costUsd: sum((t) => t.cost_usd),
    steps: sum((t) => t.steps) / n,
  };
}

export async function createStudy(user: Pick<User, "id">, raw: unknown) {
  const s = studyInput.parse(raw);
  if (s.kind === "skill" && !s.skill) throw new HttpError(400, "a skill evaluation names its skill");
  const models = s.runs.map((r) => r.model);
  if (new Set(models).size !== models.length) throw new HttpError(400, "one run per model");
  const ranked = s.runs.map((r) => ({ model: r.model, ...runStats(r) })).sort((a, b) => b.score - a.score || a.durationS - b.durationS);
  return db.evaluationStudy.create({
    data: {
      publisherId: user.id,
      kind: s.kind,
      title: s.title,
      domain: s.domain,
      skill: s.skill ?? null,
      summary: s.summary,
      body: s.body,
      suite: s.suite,
      judgeModel: s.judge ?? null,
      clientVersion: s.client_version ?? null,
      testedAt: new Date(s.tested_at * 1000),
      testedUntil: s.tested_until ? new Date(s.tested_until * 1000) : null,
      runs: s.runs as object,
      models: models.join(","),
      bestModel: ranked[0]?.model ?? null,
      bestScore: ranked[0]?.score ?? null,
    },
  });
}
