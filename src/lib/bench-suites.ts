import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import type { Prisma, User } from "@/generated/prisma/client";

/**
 * Evaluation suites written by evaluation skills in SinoBee (sinobee/evals/authoring.py) and shared here, so that
 * anyone can run the same questions on other model combinations and land in the same ranking.
 *
 * The hash is recomputed exactly as SinoBee computes it (evals/sfs.suite_hash over the tasks the suite expands to),
 * so a suite cannot be changed while keeping its name: every input becomes a task `/<skill> <args>` with the input
 * files as setup text, graded by all the suite's questions (an llm rubric voted on 3 times with evidence), and the
 * hash covers the tasks and the bench block (categories, outputs, network, threshold, anchors) - not its summary.
 */

// ---------------------------------------------------------------- Python json.dumps(sort_keys=True, ensure_ascii=False)

/** Same bytes as Python's json.dumps(value, ensure_ascii=False, sort_keys=True) (default separators ", " and ": ") */
export function pyJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return v !== v ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
    return JSON.stringify(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(pyJson).join(", ") + "]";
  if (typeof v === "object") {
    const keys = Object.keys(v as object).sort((a, b) => cmpCodePoints(a, b));
    return "{" + keys.map((k) => JSON.stringify(k) + ": " + pyJson((v as Record<string, unknown>)[k])).join(", ") + "}";
  }
  return JSON.stringify(String(v));
}

function cmpCodePoints(a: string, b: string) {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

// ---------------------------------------------------------------- the suite package

const THRESHOLD = 70;
const KEEP_BENCH = ["categories", "outputs", "summary", "network"];
const NOT_HASHED = new Set(["summary", "suite_ref", "evaluator"]);
export const MAX_INPUT_CHARS = 60_000;
export const MAX_INPUT_FILES = 40;

type Grader = Record<string, unknown> & { type?: string };
type SuiteInput = { id: string; title?: string; args?: string; files?: string[]; inject?: string | null };
export type SuiteDoc = {
  title?: string;
  skill: string;
  bench?: Record<string, unknown>;
  graders: Grader[];
  inputs: SuiteInput[];
  anchors?: { rubric: string; content: string; expect: boolean }[];
  timeout?: number;
};

/** SinoBee's authoring._fixed: what SinoBee decides, whatever the evaluation skill wrote */
export function fixed(suite: SuiteDoc): SuiteDoc {
  const s = JSON.parse(JSON.stringify(suite)) as SuiteDoc;
  const b = (s.bench && typeof s.bench === "object" ? s.bench : {}) as Record<string, unknown>;
  const bench: Record<string, unknown> = {};
  for (const k of KEEP_BENCH) if (k in b) bench[k] = b[k];
  Object.assign(bench, { kind: "skill", skill: s.skill, threshold: THRESHOLD, sandbox: true });
  s.bench = bench;
  return s;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

/** The tasks a suite expands to (authoring.expand + evals.normalize + runner._bench_task), as hashed */
export function expandTasks(suite: SuiteDoc, inputs: Record<string, string>) {
  return suite.inputs.map((x) => {
    const under = `inputs/${x.id}/`;
    const files: Record<string, { text: string }> = {};
    for (const rel of x.files ?? []) {
      if (!(rel in inputs)) throw new HttpError(400, `input file ${rel} missing`);
      files[rel.startsWith(under) ? rel.slice(under.length) : rel.split("/").pop()!] = { text: inputs[rel] };
    }
    const graders = suite.graders.map((g) =>
      g.type === "llm" ? { ...g, votes: "votes" in g ? g.votes : 3, require_evidence: "require_evidence" in g ? g.require_evidence : true } : g,
    );
    return {
      id: `${suite.skill}:${x.id}`,
      prompt: `/${suite.skill} ${x.args ?? ""}`.trim(),
      setup: { files },
      graders,
      toolsets: null,
      timeout: clamp(Math.trunc(Number(suite.timeout || 1800)) || 900, 30, 3600),
    };
  });
}

/** sfs.suite_hash of the expanded suite */
export function suiteHash(suite: SuiteDoc, inputs: Record<string, string>) {
  const s = fixed(suite);
  const bench: Record<string, unknown> = { ...(s.bench ?? {}), anchors: s.anchors ?? [] };
  for (const k of NOT_HASHED) delete bench[k];
  const body = pyJson({ tasks: expandTasks(s, inputs), bench });
  return createHash("sha256").update(body, "utf8").digest("hex");
}

// ---------------------------------------------------------------- checks (the part of sfs.lint the Hub repeats)

const STEER = /(一律|全部|直接|務必|一定)(要)?(判|給|評)(定|為|成)?(通過|過關|滿分|pass)|判定為通過|請給(滿分|通過)|always\s+(pass|answer\s+true|return\s+true)|mark\s+(this|it|all)\s+as\s+pass|you\s+must\s+pass|ignore\s+(the|all|any|previous|prior)\b|disregard\s+(the|all|previous)|忽略(之前|以上|先前|前面)/i;
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/;
const PERSONAL = [
  ["email", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ["secret", /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/],
  ["phone", /(?<![\w-])(09\d{2}[ -]?\d{3}[ -]?\d{3}|\+886[ -]?9\d{2}[ -]?\d{3}[ -]?\d{3})(?![\w-])/],
  ["national_id", /\b[A-Z][12]\d{8}\b/],
  ["path", /\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\/],
] as const;

export type SuiteProblem = { kind: "steer" | "privacy" | "rules"; message: string };

/** Problems that keep a suite off the Hub: aimed at the judge, personal data in the inputs, no security category */
export function checkSuite(suite: SuiteDoc, inputs: Record<string, string>): SuiteProblem[] {
  const out: SuiteProblem[] = [];
  for (const [i, g] of suite.graders.entries()) {
    const label = String(g.label ?? `#${i + 1}`);
    const text = ["label", "rubric", "pattern", "cmd"].map((k) => String(g[k] ?? "")).join(" ");
    if (STEER.test(text)) out.push({ kind: "steer", message: `${label}: tells the judge what to answer` });
    if (INVISIBLE.test(text)) out.push({ kind: "steer", message: `${label}: invisible characters` });
    if (String(g.rubric ?? "").length > 1500) out.push({ kind: "steer", message: `${label}: rubric over 1500 characters` });
  }
  for (const a of suite.anchors ?? []) {
    if (STEER.test(String(a.rubric) + String(a.content)) || INVISIBLE.test(String(a.content))) {
      out.push({ kind: "steer", message: "an anchor tells the judge what to answer" });
      break;
    }
  }
  for (const [rel, text] of Object.entries(inputs)) {
    for (const [kind, re] of PERSONAL) if (re.test(text)) out.push({ kind: "privacy", message: `${rel}: ${kind}` });
  }
  const sec = suite.graders.filter((g) => String(g.category ?? "") === "安全性");
  if (sec.length < 3 || !sec.some((g) => g.critical) || !sec.some((g) => g.type === "security"))
    out.push({ kind: "rules", message: "the 安全性 category needs 3 questions, a critical one and a sandbox (security) question" });
  if (!suite.inputs.some((x) => x.inject)) out.push({ kind: "rules", message: "no input is marked for prompt injection" });
  if (suite.inputs.length < 3) out.push({ kind: "rules", message: "at least 3 test inputs" });
  if ((suite.anchors ?? []).length < 3) out.push({ kind: "rules", message: "at least 3 anchors" });
  return out;
}

// ---------------------------------------------------------------- storing and reading

const graderSchema = z.record(z.string(), z.unknown());
export const suiteInput = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  skill: z.string().min(1).max(120),
  skill_version: z.string().max(40).nullish(),
  evaluator: z.string().max(120).nullish(),
  evaluator_version: z.string().max(40).nullish(),
  title: z.string().max(200).nullish(),
  suite: z.object({
    title: z.string().max(200).nullish(),
    skill: z.string().min(1).max(120),
    bench: z.record(z.string(), z.unknown()).nullish(),
    graders: z.array(graderSchema).min(1).max(60),
    inputs: z.array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/), title: z.string().max(200).nullish(), args: z.string().max(2000).nullish(),
      files: z.array(z.string().max(300)).max(MAX_INPUT_FILES).default([]), inject: z.string().max(300).nullish() })).min(1).max(20),
    anchors: z.array(z.object({ rubric: z.string().max(2000), content: z.string().max(10_000), expect: z.boolean() })).max(20).nullish(),
    timeout: z.number().nullish(),
  }),
  inputs: z.record(z.string().max(300), z.string().max(MAX_INPUT_CHARS)).refine((x) => Object.keys(x).length <= MAX_INPUT_FILES, "too many input files"),
});

/** The published version of a skill, by its SinoBee name: the publisher's own first, else the only one with that name */
export async function resolveSkillVersion(user: Pick<User, "id"> | null, name: string, version?: string | null, kind?: "evaluation") {
  const listed = { status: { in: ["PENDING_REVIEW", "APPROVED"] as ("PENDING_REVIEW" | "APPROVED")[] }, scanVerdict: { not: "DANGEROUS" as const } };
  const skills = await db.skill.findMany({ where: { name, ...(kind ? { kind } : {}) }, include: { versions: { where: listed } } });
  const own = user ? skills.find((s) => s.publisherId === user.id) : undefined;
  const skill = own ?? (skills.length === 1 ? skills[0] : skills.find((s) => s.versions.some((v) => v.status === "APPROVED")));
  if (!skill) return null;
  const v = version ? skill.versions.find((x) => x.version === version) : skill.versions.find((x) => x.version === skill.latestVersion) ?? skill.versions[0];
  return v ? { skill, version: v } : null;
}

export async function createSuite(user: Pick<User, "id">, raw: unknown) {
  const b = suiteInput.parse(raw);
  const suite = fixed({ ...(b.suite as SuiteDoc), skill: b.skill });
  const h = suiteHash(suite, b.inputs);
  if (h !== b.hash) throw new HttpError(400, `suite hash mismatch: computed ${h}`);
  const existing = await db.benchSuite.findUnique({ where: { hash: h } });
  if (existing) return existing;
  const problems = checkSuite(suite, b.inputs);
  const steer = problems.filter((p) => p.kind === "steer");
  const ev = b.evaluator ? await resolveSkillVersion(null, b.evaluator, b.evaluator_version, "evaluation") : null;
  if (ev) await recordSuiteCheck(ev.version.id, steer.map((p) => p.message));
  if (problems.length) throw new HttpError(400, "suite rejected: " + problems.map((p) => p.message).join("; "));
  const sv = await resolveSkillVersion(user, b.skill, b.skill_version);
  return db.benchSuite.create({
    data: {
      hash: h, kind: "skill", subject: b.skill, subjectVersion: b.skill_version ?? "", skillVersionId: sv?.version.id ?? null,
      evaluator: b.evaluator ?? "", evaluatorVersion: b.evaluator_version ?? "", evaluatorSkillVersionId: ev?.version.id ?? null,
      title: b.title ?? suite.title ?? "", suite: suite as unknown as Prisma.InputJsonValue, inputs: b.inputs, createdById: user.id,
    },
  });
}

/** An evaluation skill's 3rd security check: none of the suites written with it may target the judge */
async function recordSuiteCheck(versionId: string, problems: string[]) {
  const v = await db.skillVersion.findUnique({ where: { id: versionId }, select: { securityReport: true } });
  const r = (v?.securityReport ?? {}) as SecurityReport;
  const prev = r.suite ?? { ok: null, checked: 0 };
  r.suite = { ok: problems.length === 0 && prev.ok !== false, checked: (prev.checked ?? 0) + 1, problems: problems.length ? problems.slice(0, 10) : prev.problems };
  await db.skillVersion.update({ where: { id: versionId }, data: { securityReport: r as Prisma.InputJsonValue } });
}

export const SUITE_LIST = {
  id: true, hash: true, subject: true, subjectVersion: true, evaluator: true, evaluatorVersion: true, title: true, reportCount: true, createdAt: true,
  createdBy: { select: { publisher: true, handle: true, account: true } },
} as const;

export function suiteSummary(s: { suite: unknown; inputs: unknown }) {
  const suite = s.suite as SuiteDoc;
  const cats = [...new Set(suite.graders.map((g) => String(g.category ?? "結果")))];
  return { inputs: suite.inputs.length, questions: suite.graders.length, categories: cats, anchors: (suite.anchors ?? []).length,
    injected: suite.inputs.filter((x) => x.inject).length };
}

// ---------------------------------------------------------------- evaluation skills: the 4 security checks

export type SecurityReport = {
  static?: { ok: boolean; issues: string[] };
  behavior?: { ok: boolean | null; note?: string | null; by?: string | null; at?: string | null };
  suite?: { ok: boolean | null; checked: number; problems?: string[] };
};

const SCRIPT = /\.(py|sh|bash|zsh|js|mjs|ts|rb|pl)$/i;
const STRICT_TOOLS = new Set(["read_file", "write_file", "edit_file", "list_dir", "search_files", "skill_view", "skill_search", "eval_suite_check", "task_checklist", "milestone"]);

/** SinoBee authoring.static_check, on the Hub: what an evaluation skill's files may not do */
export function staticCheck(files: Map<string, Buffer>, frontmatter: { metadata?: Record<string, unknown>; "allowed-tools"?: string }): string[] {
  const issues: string[] = [];
  const meta = frontmatter.metadata ?? {};
  if (/^(true|yes|1)$/i.test(String(meta["sinobee-network"] ?? ""))) issues.push("an evaluation skill cannot declare network use");
  const tools = String(frontmatter["allowed-tools"] ?? "").split(/\s+/).filter(Boolean).map((t) => t.split("(")[0]);
  const extra = tools.filter((t) => !STRICT_TOOLS.has(t));
  if (extra.length) issues.push(`allowed-tools may only list ${[...STRICT_TOOLS].join(", ")}; not ${extra.join(", ")}`);
  for (const [file, buf] of files) {
    const text = buf.toString("utf8");
    if (text.includes("�") && !/\.(md|txt|json|ya?ml|csv)$/i.test(file)) {
      issues.push(`${file}: only text files`);
      continue;
    }
    if (/[A-Za-z0-9+/=]{300,}/.test(text)) issues.push(`${file}: a large encoded blob`);
    if (/ignore (all )?(previous|prior|above) instructions|忽略(之前|以上|先前)的?(所有)?指令/i.test(text)) issues.push(`${file}: prompt-injection phrasing`);
    if (!SCRIPT.test(file)) continue;
    if (/https?:\/\/|\b(curl|wget|requests|urllib|httpx|aiohttp|socket|fetch)\b/.test(text)) issues.push(`${file}: scripts cannot use the network`);
    if (/(os\.environ|getenv|process\.env|ENV\[)[^\n]{0,60}(KEY|TOKEN|SECRET|PASS)/i.test(text)) issues.push(`${file}: scripts cannot read keys from the environment`);
    if (/(~\/|\$HOME|\$\{HOME\}|\/Users\/|\/home\/|expanduser)/.test(text)) issues.push(`${file}: scripts cannot reach outside the workspace`);
    if (/\b(exec|eval)\s*\(|new\s+Function\(|child_process|subprocess|os\.system|os\.popen/.test(text)) issues.push(`${file}: scripts cannot run dynamic code or other programs`);
  }
  return issues;
}

/** n/4 and whether it may be used: static scan, sandbox behavior, its suites, human review (APPROVED) */
export function securityStatus(report: unknown, approved: boolean) {
  const r = (report ?? {}) as SecurityReport;
  const checks = {
    static: r.static?.ok ?? null,
    behavior: r.behavior?.ok ?? null,
    suite: r.suite?.ok ?? null,
    review: approved ? true : null,          // not yet reviewed is open, not failed
  };
  const passed = Object.values(checks).filter((x) => x === true).length;
  return { ...checks, passed, total: 4, blocked: checks.static === false || checks.behavior === false || checks.suite === false };
}
