import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { currentModels, type ModelPriceView } from "../models";
import { costTwd } from "../llm/quota";
import { NO_PLATFORM_MODEL, jobHasModel, platformChat, type ChatMessage, type ChatUsage } from "../platform-model";
import type { Prisma } from "@/generated/prisma/client";
import { creditLeft, feeWaived, ownDraft, placeholderTitle, useCredit } from "./proposal";
import { CATEGORIES, EVAL_METHODS, isCategory, normalizeSpec, type Spec } from "./rules";
import type { ChecklistItem } from "./checklist-default";
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

function systemPrompt(task: DraftTask, model: ModelPriceView | undefined, spec: Spec | null, checklist: ChecklistItem[] = []) {
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
    `Container time costs about NT$${vmTwd.toFixed(1)} per hour. A typical research or analysis task uses 0.5–5 million input tokens, with output around 10–20% of input, and 0.5–3 container hours.`,
    "Estimate from the work itself (sources to read, pages or records to process, files to write), not from the budget; p90 is usually 1.5–2× p50 and must cover retries and partial failures.",
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
    "",
    "The proposal is screened by AI against the checklist below and opens only if EVERY item is met, so write the spec to meet all of them:",
    "- summary: the problem, the background and the expected result, in plain words a backer understands; no hype or marketing.",
    "- scope: what is done, the language of the deliverables (e.g. Traditional Chinese), and the intended use of the results; outOfScope: what is not done.",
    "- deliverables: concrete files under outputs/ with their format (e.g. \"outputs/report.md — 分析報告（Markdown，繁體中文）\"); include every script, dataset or chart that an acceptance criterion mentions; cite sources when others' data is used.",
    "- method: traceable steps or milestones that name the data sources (public sources only, or files the proposer uploaded); no logins, paid accounts, CAPTCHAs, live human help or physical actions.",
    "- acceptance: 3 to 7 criteria, each objectively checkable yes/no and naming the deliverable it checks; every deliverable is checked by at least one criterion; nothing depends on the proposer's personal taste.",
    "- estimate.basis: the expected tokens, container hours and data size behind the numbers; size the task to fit one run.",
    "- risks: data availability and external services, plus one item saying exactly which partial results are delivered if the task cannot be completed in full.",
    "- stretch (optional): each extra scope with its own feasible cost.",
    "Never plan anything that collects personal data about identifiable people, bypasses access controls or site terms, copies protected works in full, or could harm people. If the idea needs that, say so in reply and draft the closest compliant version instead.",
    "Before answering, check the draft against every checklist item and fix what would fail.",
    ...(checklist.length ? ["Checklist:", ...checklist.map((i) => `${i.id} ${i.en}`)] : []),
  ].join("\n");
}

type Usage = ChatUsage;

/** The platform model (falling back to the next usable one on errors); the development stand-in when no key is set */
async function callModel(system: string, messages: ChatMessage[]): Promise<{ text: string; usage: Usage; price: ModelPriceView | null }> {
  if (!(await jobHasModel("spec"))) {
    if (process.env.NODE_ENV === "production") throw new HttpError(503, NO_PLATFORM_MODEL);
    // the development stand-in answers at once; tests can slow it down to watch a running job
    if (process.env.SPEC_MOCK_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.SPEC_MOCK_DELAY_MS)));
    const first = (await currentModels())[0] ?? null;
    return { ...mockReply(messages), price: first };
  }
  return platformChat({ job: "spec", system, messages, maxTokens: MAX_OUTPUT });
}

/** Development stand-in when no model key is configured (never in production) */
function mockReply(messages: { role: string; content: string }[]): { text: string; usage: Usage } {
  const n = messages.filter((m) => m.role === "user").length;
  const last = messages[messages.length - 1]?.content ?? "";
  const spec: Spec = {
    summary: `(模擬) ${last.slice(0, 120)}`,
    deliverables: ["outputs/report.md — 主要成果報告", "outputs/data.csv — 整理後的資料"],
    method: ["蒐集與整理資料", "分析並撰寫報告", "自我檢查驗收條件"],
    acceptance: ["report.md 涵蓋規格中的每個問題", "data.csv 欄位有說明且可重現", "report.md 列出資料來源、限制與假設"],
    estimate: { p50Twd: 300, p90Twd: 540, basis: "mock: about 1.5M input tokens and 1 hour of container time" },
    stretch: [{ title: "英文版報告", twd: 150 }],
    risks: ["資料來源可能需要登入", "若無法完整完成，仍交付已整理的 data.csv 與部分報告"],
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
  await checkCredit(task);
  if (jobs.get(taskId)?.state !== "running") runJob(taskId, "generate", () => generateSpec(userId, taskId));
  return { state: "running" as const };
}

/** Start one dialogue turn in the background */
export async function startTurn(userId: string, taskId: string, message: string) {
  if (!message.trim()) throw new HttpError(400, "message is required");
  await checkCredit(await ownDraft(userId, taskId));
  runJob(taskId, "turn", () => specTurn(userId, taskId, message));
  return { state: "running" as const };
}

async function ask(task: Task, chat: ChatTurn[], message: string) {
  const models = await currentModels();
  const current = task.spec ? normalizeSpec(task.spec) : null;
  const skill = task.skillVersionId ? (await db.skillVersion.findUnique({ where: { id: task.skillVersionId }, include: { skill: true } }))?.skill.name : null;
  const messages = [...chat.map((c) => ({ role: c.role, content: c.content })), { role: "user" as const, content: message }];
  // the model configured for the platform (or the next one with an API key that works), never a fixed vendor
  const checklist = (await (await import("./checklist")).currentChecklist()).items;
  const { text: answer, usage, price } = await callModel(systemPrompt({ ...task, skill }, models.find((m) => m.modelId === task.model), current, checklist), messages);
  const cost = price ? costTwd(price.twd, usage) : 0;
  // the call already happened: charge it even if it takes the credit slightly below zero
  await useCredit(task.id, cost, { allowOverdraw: true });
  return { parsed: parseAnswer(answer), cost, current };
}

async function checkCredit(task: Task) {
  if (await feeWaived(task.userId)) return; // subscribed: no fee, no limit
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
  await checkCredit(task);
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
  await checkCredit(task);
  const chat = ((task.specChat ?? []) as ChatTurn[]).slice(-MAX_TURNS);
  // the dialogue starts with the model's own draft; the API wants a user turn first
  const history = chat[0]?.role === "assistant" ? [{ role: "user" as const, content: "Draft the proposal from my description.", at: chat[0].at }, ...chat] : chat;
  const { parsed, cost, current } = await ask(task, history, text);
  const now = new Date().toISOString();
  const nextChat: ChatTurn[] = [...chat, { role: "user", content: text, at: now }, { role: "assistant", content: parsed.reply || "…", at: now }];
  const updated = await db.task.update({ where: { id: taskId }, data: { specChat: nextChat as unknown as Prisma.InputJsonValue, ...applied(task, parsed) } });
  return { reply: parsed.reply, spec: parsed.spec ?? current, costTwd: cost, creditLeft: creditLeft(updated) };
}
