import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { currentModels, type ModelPriceView } from "../models";
import { costTwd } from "../llm/quota";
import type { Prisma } from "@/generated/prisma/client";
import { creditLeft, ownDraft, useCredit } from "./proposal";
import { normalizeSpec, type Spec } from "./rules";

/**
 * The spec dialogue: the proposer talks with a model that asks what it needs and drafts the crowdfunding proposal
 * (requirements, deliverables, method and milestones, acceptance criteria, cost estimate, stretch goals, risks).
 * Every turn is charged at published prices to the proposal credit; when the credit runs out the dialogue stops
 * until another proposal fee is bought.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string; at: string };

const MAX_TURNS = 40;
const MAX_OUTPUT = 2500;

function systemPrompt(task: { title: string; prompt: string; model: string }, model: ModelPriceView | undefined, spec: Spec | null) {
  const fx = model?.fx ?? 32.5;
  const vmTwd = config.pricing.vmHourlyUsd * fx * config.pricing.markup;
  return [
    "You help a proposer on SinoBee.ai turn an idea into a crowdfunding proposal for an AI agent task.",
    "The task will be run autonomously by the SinoBee agent in an isolated Linux container with internet access; backers pay for it in shares of NT$30.",
    "Reply in the proposer's language (Traditional Chinese if they write Chinese). Be concise. Ask at most 3 questions per turn, only what changes the plan.",
    "",
    `Task title: ${task.title}`,
    `Proposer's description: ${task.prompt}`,
    `Agent model: ${task.model}${model ? ` (published price per 1M tokens: input NT$${model.twd.input.toFixed(1)}, output NT$${model.twd.output.toFixed(1)})` : ""}`,
    `Container time costs about NT$${vmTwd.toFixed(1)} per hour. A typical research or analysis task uses 0.5–5 million input tokens.`,
    spec ? `Current draft spec (JSON): ${JSON.stringify(spec)}` : "No spec drafted yet.",
    "",
    "Always answer with ONE JSON object and nothing else:",
    '{"reply": "<your message to the proposer, markdown>", "spec": <the full updated spec, or null if nothing to draft yet>}',
    "spec shape:",
    '{"summary": "...", "scope": "...", "outOfScope": "...", "deliverables": ["file or result, format"], "method": ["step / milestone"],',
    ' "acceptance": ["3-7 checkable criteria, prefer ones the agent can verify itself"], "estimate": {"p50Twd": <int>, "p90Twd": <int>, "basis": "tokens, hours, why"},',
    ' "stretch": [{"title": "extra scope", "twd": <int extra cost>}], "risks": ["data availability, external APIs, partial delivery if it fails"]}',
    "Estimates are total TWD for the agent run (tokens + container time + storage) at the prices above; p90 is the amount that covers 9 of 10 runs.",
    "Keep everything the proposer already agreed to; never invent facts about their data.",
  ].join("\n");
}

type Usage = { prompt: number; output: number; cacheRead: number; cacheWrite: number };

async function callModel(model: ModelPriceView, system: string, messages: { role: "user" | "assistant"; content: string }[]): Promise<{ text: string; usage: Usage }> {
  const provider = model.modelId.split("/")[0];
  const p = config.llm.providers[provider];
  const upstream = model.modelId.split("/").slice(1).join("/");
  if (!p?.key) {
    if (process.env.NODE_ENV === "production") throw new HttpError(503, `${provider} models are not available right now`);
    return mockReply(messages);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
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
      body: JSON.stringify({ model: upstream, messages: [{ role: "system", content: system }, ...messages], [provider === "openai" ? "max_completion_tokens" : "max_tokens"]: MAX_OUTPUT }),
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
  const text = JSON.stringify({ reply: n === 1 ? "（開發模式模擬回覆）我先依你的描述起草了規格，請確認交付物與驗收條件是否正確。" : "（開發模式模擬回覆）已更新規格。", spec });
  return { text, usage: { prompt: 1500 * n, output: 600, cacheRead: 0, cacheWrite: 0 } };
}

/** The first {...} block in the model's answer, parsed; falls back to plain text as the reply */
export function parseAnswer(text: string): { reply: string; spec: Spec | null } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(text.slice(start, end + 1)) as { reply?: unknown; spec?: unknown };
      return { reply: typeof j.reply === "string" ? j.reply : "", spec: j.spec && typeof j.spec === "object" ? normalizeSpec(j.spec) : null };
    } catch {
      /* not JSON */
    }
  }
  return { reply: text.trim(), spec: null };
}

/** One dialogue turn. Returns the assistant's reply, the updated spec and the credit left. */
export async function specTurn(userId: string, taskId: string, message: string) {
  const task = await ownDraft(userId, taskId);
  const text = message.trim().slice(0, 8000);
  if (!text) throw new HttpError(400, "message is required");
  if (Number(task.proposalCreditTwd) <= 0) throw new HttpError(402, "pay the proposal fee to start the spec dialogue");
  if (creditLeft(task) <= 0.01) throw new HttpError(402, "proposal credit used up — buy another proposal fee to continue");
  const chat = ((task.specChat ?? []) as ChatTurn[]).slice(-MAX_TURNS);
  const models = await currentModels();
  const model = models.find((m) => m.modelId === config.crowd.specModel) ?? models.find((m) => m.enabled);
  if (!model) throw new HttpError(503, "no model available for the spec dialogue");
  const current = task.spec ? normalizeSpec(task.spec) : null;
  const messages = [...chat.map((c) => ({ role: c.role, content: c.content })), { role: "user" as const, content: text }];
  const { text: answer, usage } = await callModel(model, systemPrompt(task, models.find((m) => m.modelId === task.model), current), messages);
  const cost = costTwd(model.twd, usage);
  // the turn already happened: charge it even if it takes the credit slightly below zero
  await useCredit(taskId, cost, { allowOverdraw: true });
  const parsed = parseAnswer(answer);
  const now = new Date().toISOString();
  const nextChat: ChatTurn[] = [...chat, { role: "user", content: text, at: now }, { role: "assistant", content: parsed.reply || "…", at: now }];
  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      specChat: nextChat as unknown as Prisma.InputJsonValue,
      ...(parsed.spec ? { spec: parsed.spec as unknown as Prisma.InputJsonValue, specVersion: { increment: 1 } } : {}),
    },
  });
  return { reply: parsed.reply, spec: parsed.spec ?? current, costTwd: cost, creditLeft: creditLeft(updated) };
}
