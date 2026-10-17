import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { currentModels, type ModelPriceView } from "../models";
import { costTwd } from "../llm/quota";
import { NO_PLATFORM_MODEL, platformModel } from "../platform-model";
import type { Prisma } from "@/generated/prisma/client";
import { creditLeft, ownDraft, placeholderTitle, useCredit } from "./proposal";
import { CATEGORIES, EVAL_METHODS, isCategory, normalizeSpec, type Spec } from "./rules";
import type { Task } from "@/generated/prisma/client";

/**
 * The spec model. Right after the proposal fee is paid it drafts the whole proposal from the description
 * (generateSpec): title, category, requirements, deliverables, method and milestones, acceptance criteria, the cost
 * estimate that sets the goal, stretch goals and risks (for evaluations also the method and criteria). The proposer
 * then edits lines by hand or asks it for changes (specTurn). Every call is charged at published prices to the
 * proposal credit; when the credit runs out the dialogue stops until another proposal fee is bought.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string; at: string };

const MAX_TURNS = 40;
/** room for a complete spec in Chinese (and for reasoning models' thinking, which counts as output) */
const MAX_OUTPUT = 8000;

type DraftTask = Pick<Task, "title" | "prompt" | "model" | "kind" | "evalMethod" | "evalCriteria" | "category"> & { skill?: string | null };

function systemPrompt(task: DraftTask, model: ModelPriceView | undefined, spec: Spec | null) {
  const fx = model?.fx ?? 32.5;
  const vmTwd = config.pricing.vmHourlyUsd * fx * config.pricing.markup;
  return [
    "You help a proposer on SinoBee.ai turn an idea into a crowdfunding proposal for an AI agent task.",
    "The task will be run autonomously by the SinoBee agent in an isolated Linux container with internet access; backers pay for it in shares of NT$30.",
    "Reply in the proposer's language (Traditional Chinese if they write Chinese). Be concise. Ask at most 3 questions per turn, only what changes the plan.",
    "",
    `Task title: ${task.title}`,
    `Category: ${task.category ?? "(not set)"}`,
    `Proposer's description: ${task.prompt}`,
    ...(task.kind === "EVALUATION"
      ? [
          "This proposal is an EVALUATION: the agent evaluates a subject (a skill on a model, or a model) and publishes a scored report. Backers fund it to get an independent result.",
          `Subject: ${task.skill ? `the skill "${task.skill}" running on ${task.model}` : `the model ${task.model}`}.`,
          `Evaluation method: ${task.evalMethod ?? "(choose one)"}; criteria / test cases: ${task.evalCriteria ? task.evalCriteria.slice(0, 4000) : "(write them)"}.`,
          "The deliverables must include outputs/evaluation.json (score 0-100, verdict, metrics, cases, process).",
        ]
      : []),
    `Agent model: ${task.model}${model ? ` (published price per 1M tokens: input NT$${model.twd.input.toFixed(1)}, output NT$${model.twd.output.toFixed(1)})` : ""}`,
    `Container time costs about NT$${vmTwd.toFixed(1)} per hour. A typical research or analysis task uses 0.5–5 million input tokens.`,
    spec ? `Current draft spec (JSON): ${JSON.stringify(spec)}` : "No spec drafted yet.",
    "",
    "Always answer with ONE JSON object and nothing else:",
    '{"reply": "<your message to the proposer, markdown>", "title": "<short title, max 40 characters, in the proposer\'s language>", "category": "<one of: ' + CATEGORIES.join(", ") + '>",',
    task.kind === "EVALUATION" ? ' "evalMethod": "<one of: ' + EVAL_METHODS.join(", ") + '>", "evalCriteria": "<criteria and test cases, one per line>",' : "",
    ' "spec": <the full updated spec>}',
    "spec shape:",
    '{"summary": "...", "scope": "...", "outOfScope": "...", "deliverables": ["file or result, format"], "method": ["step / milestone"],',
    ' "acceptance": ["3-7 checkable criteria, prefer ones the agent can verify itself"], "estimate": {"p50Twd": <int>, "p90Twd": <int>, "basis": "tokens, hours, why"},',
    ' "stretch": [{"title": "extra scope", "twd": <int extra cost>}], "risks": ["data availability, external APIs, partial delivery if it fails"]}',
    "Estimates are total TWD for the agent run (tokens + container time + storage) at the prices above; p90 is the amount that covers 9 of 10 runs.",
    "Always return the full spec, filled in as well as you can from what you know; list open assumptions in risks instead of leaving parts empty.",
    "Keep everything the proposer already agreed to; never invent facts about their data.",
  ].join("\n");
}

type Usage = { prompt: number; output: number; cacheRead: number; cacheWrite: number };

async function callModel(model: ModelPriceView, system: string, messages: { role: "user" | "assistant"; content: string }[]): Promise<{ text: string; usage: Usage }> {
  const provider = model.modelId.split("/")[0];
  const p = config.llm.providers[provider];
  const upstream = model.modelId.split("/").slice(1).join("/");
  if (!p?.key) {
    if (process.env.NODE_ENV === "production") throw new HttpError(503, NO_PLATFORM_MODEL);
    // the development stand-in answers at once; tests can slow it down to watch a running job
    if (process.env.SPEC_MOCK_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.SPEC_MOCK_DELAY_MS)));
    return mockReply(messages);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 240_000);
  try {
    if (p.kind === "anthropic") {
      const r = await fetch(`${p.base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: upstream, system, messages, max_tokens: MAX_OUTPUT }),
        signal: ctrl.signal,
      });
      const j = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; usage?: Record<string, number>; error?: { message?: string } };
      if (!r.ok) throw new HttpError(502, `spec model error: ${j.error?.message ?? r.status}`);
      const u = j.usage ?? {};
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheWrite = u.cache_creation_input_tokens ?? 0;
      return { text: (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""), usage: { prompt: (u.input_tokens ?? 0) + cacheRead + cacheWrite, output: u.output_tokens ?? 0, cacheRead, cacheWrite } };
    }
    const r = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.key}` },
      body: JSON.stringify({ model: upstream, messages: [{ role: "system", content: system }, ...messages], [provider === "openai" ? "max_completion_tokens" : "max_tokens"]: provider === "openai" ? MAX_OUTPUT * 2 : MAX_OUTPUT }),
      signal: ctrl.signal,
    });
    const j = (await r.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }; error?: { message?: string } };
    if (!r.ok) throw new HttpError(502, `spec model error: ${j.error?.message ?? r.status}`);
    return { text: j.choices?.[0]?.message?.content ?? "", usage: { prompt: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, cacheRead: j.usage?.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: 0 } };
  } finally {
    clearTimeout(timer);
  }
}

/** Development stand-in when no model key is configured (never in production) */
function mockReply(messages: { role: string; content: string }[]): { text: string; usage: Usage } {
  const n = messages.filter((m) => m.role === "user").length;
  const last = messages[messages.length - 1]?.content ?? "";
  const spec: Spec = {
    summary: `(模擬) ${last.slice(0, 120)}`,
    deliverables: ["outputs/report.md — 主要成果報告", "outputs/data.csv — 整理後的資料"],
    method: ["蒐集與整理資料", "分析並撰寫報告", "自我檢查驗收條件"],
    acceptance: ["report.md 涵蓋規格中的每個問題", "data.csv 欄位有說明且可重現", "SUMMARY.md 列出限制與假設"],
    estimate: { p50Twd: 300, p90Twd: 540, basis: "mock: about 1.5M input tokens and 1 hour of container time" },
    stretch: [{ title: "英文版報告", twd: 150 }],
    risks: ["資料來源可能需要登入"],
  };
  const text = JSON.stringify({
    reply: n === 1 ? "（開發模式模擬回覆）我先依你的描述起草了規格，請確認交付物與驗收條件是否正確。" : "（開發模式模擬回覆）已更新規格。",
    title: "（模擬）公開資料整理報告",
    category: "data",
    evalMethod: "rubric",
    evalCriteria: "正確性\n完整性\n可重現性",
    spec,
  });
  return { text, usage: { prompt: 1500 * n, output: 600, cacheRead: 0, cacheWrite: 0 } };
}

/** The first {...} block in the model's answer, parsed; falls back to plain text as the reply */
export type Answer = { reply: string; spec: Spec | null; title?: string; category?: string; evalMethod?: string; evalCriteria?: string };

export function parseAnswer(text: string): Answer {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
      return {
        reply: typeof j.reply === "string" ? j.reply : "",
        spec: j.spec && typeof j.spec === "object" ? normalizeSpec(j.spec) : null,
        title: str(j.title, 120),
        category: isCategory(j.category) ? j.category : undefined,
        evalMethod: (EVAL_METHODS as readonly string[]).includes(String(j.evalMethod)) ? String(j.evalMethod) : undefined,
        evalCriteria: str(j.evalCriteria, 10_000),
      };
    } catch {
      /* not JSON */
    }
  }
  return { reply: text.trim(), spec: null };
}

/** What the model's answer changes on the draft: the spec, the category, and the title while it is still the placeholder */
function applied(task: Task, a: Answer): Prisma.TaskUpdateInput {
  return {
    ...(a.spec ? { spec: a.spec as unknown as Prisma.InputJsonValue, specVersion: { increment: 1 } } : {}),
    ...(a.category ? { category: a.category } : {}),
    ...(a.title && a.title.length >= 3 && task.title === placeholderTitle(task.prompt) ? { title: a.title } : {}),
    ...(task.kind === "EVALUATION" && a.evalMethod ? { evalMethod: a.evalMethod } : {}),
    ...(task.kind === "EVALUATION" && a.evalCriteria ? { evalCriteria: a.evalCriteria } : {}),
  };
}

/**
 * Model calls take from seconds to a few minutes, longer than proxies in front of the site wait for a response. So
 * the browser starts a job (startGenerate / startTurn), the model runs in the background and the page polls
 * specJobState until the draft is updated. Jobs live in this server process; one per proposal at a time.
 */
type Job = { state: "running" | "error"; kind: "generate" | "turn"; error?: string; at: number };
const g = globalThis as unknown as { __sbSpecJobs?: Map<string, Job> };
const jobs = (g.__sbSpecJobs ??= new Map<string, Job>());

/** What the page polls: the job and whether the spec exists yet (owner only) */
export async function specProgress(userId: string, taskId: string) {
  const task = await ownDraft(userId, taskId);
  return { ...specJobState(taskId), hasSpec: !!task.spec, chatLength: Array.isArray(task.specChat) ? task.specChat.length : 0 };
}

export function specJobState(taskId: string): { state: "idle" | "running" | "error"; kind?: string; error?: string } {
  const j = jobs.get(taskId);
  if (!j) return { state: "idle" };
  // a job that never finished (a crash) does not block the proposal forever
  if (j.state === "running" && Date.now() - j.at > 10 * 60_000) {
    jobs.delete(taskId);
    return { state: "idle" };
  }
  return { state: j.state, kind: j.kind, error: j.error };
}

function runJob(taskId: string, kind: Job["kind"], work: () => Promise<unknown>) {
  if (jobs.get(taskId)?.state === "running") throw new HttpError(409, "the AI is still working on this proposal");
  jobs.set(taskId, { state: "running", kind, at: Date.now() });
  void work().then(
    () => jobs.delete(taskId),
    (e) => {
      console.warn("spec job", taskId, kind, (e as Error).message);
      jobs.set(taskId, { state: "error", kind, error: (e as Error).message.slice(0, 500), at: Date.now() });
    },
  );
}

/** Start drafting the spec in the background (no-op when it exists or is being drafted) */
export async function startGenerate(userId: string, taskId: string) {
  const task = await ownDraft(userId, taskId);
  if (task.spec) return { state: "done" as const };
  checkCredit(task);
  if (jobs.get(taskId)?.state !== "running") runJob(taskId, "generate", () => generateSpec(userId, taskId));
  return { state: "running" as const };
}

/** Start one dialogue turn in the background */
export async function startTurn(userId: string, taskId: string, message: string) {
  if (!message.trim()) throw new HttpError(400, "message is required");
  checkCredit(await ownDraft(userId, taskId));
  runJob(taskId, "turn", () => specTurn(userId, taskId, message));
  return { state: "running" as const };
}

async function ask(task: Task, chat: ChatTurn[], message: string) {
  const models = await currentModels();
  // the model configured for the platform (or the first one with an API key), never a fixed vendor
  const pm = await platformModel();
  if (!pm && process.env.NODE_ENV === "production") throw new HttpError(503, NO_PLATFORM_MODEL);
  const model = pm?.model ?? models[0];
  if (!model) throw new HttpError(503, NO_PLATFORM_MODEL);
  const current = task.spec ? normalizeSpec(task.spec) : null;
  const skill = task.skillVersionId ? (await db.skillVersion.findUnique({ where: { id: task.skillVersionId }, include: { skill: true } }))?.skill.name : null;
  const messages = [...chat.map((c) => ({ role: c.role, content: c.content })), { role: "user" as const, content: message }];
  const { text: answer, usage } = await callModel(model, systemPrompt({ ...task, skill }, models.find((m) => m.modelId === task.model), current), messages);
  const cost = costTwd(model.twd, usage);
  // the call already happened: charge it even if it takes the credit slightly below zero
  await useCredit(task.id, cost, { allowOverdraw: true });
  return { parsed: parseAnswer(answer), cost, current };
}

function checkCredit(task: Task) {
  if (Number(task.proposalCreditTwd) <= 0) throw new HttpError(402, "pay the proposal fee first");
  if (creditLeft(task) <= 0.01) throw new HttpError(402, "proposal credit used up — buy another proposal fee to continue");
}

/**
 * Draft the whole proposal from the description (once, right after the proposal fee is paid). Returns the draft as it
 * is when a spec already exists.
 */
export async function generateSpec(userId: string, taskId: string) {
  const task = await ownDraft(userId, taskId);
  if (task.spec) return { generated: false, spec: normalizeSpec(task.spec), creditLeft: creditLeft(task) };
  checkCredit(task);
  {
    const instruction =
      "Draft the complete crowdfunding proposal from my description now: a short title, the category, every part of the spec and the cost estimate" +
      (task.kind === "EVALUATION" ? ", plus the evaluation method and criteria" : "") +
      ". In the reply, say in two or three sentences what you assumed and what I should check.";
    const { parsed, cost } = await ask(task, [], instruction);
    if (!parsed.spec) throw new HttpError(502, "the AI did not return a complete spec; try again");
    const now = new Date().toISOString();
    const chat: ChatTurn[] = [{ role: "assistant", content: parsed.reply || "…", at: now }];
    const updated = await db.task.update({ where: { id: taskId }, data: { specChat: chat as unknown as Prisma.InputJsonValue, ...applied(task, parsed) } });
    return { generated: true, spec: updated.spec ? normalizeSpec(updated.spec) : null, costTwd: cost, creditLeft: creditLeft(updated) };
  }
}

/** One dialogue turn. Returns the assistant's reply, the updated spec and the credit left. */
export async function specTurn(userId: string, taskId: string, message: string) {
  const task = await ownDraft(userId, taskId);
  const text = message.trim().slice(0, 8000);
  if (!text) throw new HttpError(400, "message is required");
  checkCredit(task);
  const chat = ((task.specChat ?? []) as ChatTurn[]).slice(-MAX_TURNS);
  // the dialogue starts with the model's own draft; the API wants a user turn first
  const history = chat[0]?.role === "assistant" ? [{ role: "user" as const, content: "Draft the proposal from my description.", at: chat[0].at }, ...chat] : chat;
  const { parsed, cost, current } = await ask(task, history, text);
  const now = new Date().toISOString();
  const nextChat: ChatTurn[] = [...chat, { role: "user", content: text, at: now }, { role: "assistant", content: parsed.reply || "…", at: now }];
  const updated = await db.task.update({ where: { id: taskId }, data: { specChat: nextChat as unknown as Prisma.InputJsonValue, ...applied(task, parsed) } });
  return { reply: parsed.reply, spec: parsed.spec ?? current, costTwd: cost, creditLeft: creditLeft(updated) };
}
