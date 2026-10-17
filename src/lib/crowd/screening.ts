import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { notify } from "../notify";
import { currentModels } from "../models";
import { addDays } from "../retention";
import { audit } from "../roles";
import type { Prisma, Task } from "@/generated/prisma/client";
import { postStatus } from "./agent";
import { normalizeSpec } from "./rules";

/**
 * Proposal screening before a campaign opens (crowd.screening):
 *   ai      a model checks the proposal against the content rules; clear ones open at once, anything doubtful
 *           waits for an admin (the model never rejects on its own)
 *   manual  every proposal waits for an admin
 *   off     proposals open at once
 * The campaign period starts when it opens, not when it was submitted. An admin rejection sends the proposal back
 * to DRAFT with the reasons (the proposal fee is not refunded); the proposer can fix it and submit again.
 */

export type Screening = { decision: "approve" | "review" | "rejected"; reasons: string[]; by: "ai" | "admin" | "off"; at: string };

const RULES = [
  "collecting or exposing personal data about private individuals (doxxing, scraping profiles, contact lists)",
  "anything illegal in Taiwan, fraud, scams, phishing, malware, hacking other people's systems or bypassing access controls",
  "weapons, drugs, self-harm, sexual content involving minors, harassment or hate",
  "copying or redistributing copyrighted works without permission (books, paid courses, music, films, paywalled articles)",
  "spam, fake reviews, impersonation, election manipulation",
  "tasks that need someone's account credentials, payments or physical actions the agent cannot do",
];

async function aiScreen(task: Task): Promise<{ decision: "approve" | "review"; reasons: string[] }> {
  const spec = task.spec ? normalizeSpec(task.spec) : null;
  const text = `${task.title}\n\n${task.prompt}\n\n${JSON.stringify(spec)}`.slice(0, 30_000);
  const models = await currentModels();
  const model = models.find((m) => m.modelId === config.crowd.specModel) ?? models.find((m) => m.enabled);
  const provider = model?.modelId.split("/")[0] ?? "";
  const p = config.llm.providers[provider];
  if (!model || !p?.key) {
    // no model key: development stand-in (production without keys sends everything to an admin)
    if (process.env.NODE_ENV === "production") return { decision: "review", reasons: ["no screening model available"] };
    return text.includes("[review]") ? { decision: "review", reasons: ["flagged by the development stand-in"] } : { decision: "approve", reasons: [] };
  }
  const system = [
    "You screen crowdfunding proposals for AI agent tasks on SinoBee.ai before they are shown to the public.",
    "Flag the proposal if it involves any of:",
    ...RULES.map((r) => `- ${r}`),
    'Answer with ONE JSON object only: {"decision": "approve" | "review", "reasons": ["short reason", ...]}.',
    "Use review when unsure. Ordinary research, analysis, writing, coding and data tasks on public information are approve.",
  ].join("\n");
  const upstream = model.modelId.split("/").slice(1).join("/");
  try {
    const r =
      p.kind === "anthropic"
        ? await fetch(`${p.base}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: upstream, system, messages: [{ role: "user", content: text }], max_tokens: 400 }) })
        : await fetch(`${p.base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.key}` }, body: JSON.stringify({ model: upstream, messages: [{ role: "system", content: system }, { role: "user", content: text }], max_tokens: 400 }) });
    const j = (await r.json().catch(() => ({}))) as { content?: { text?: string }[]; choices?: { message?: { content?: string } }[] };
    const out = p.kind === "anthropic" ? (j.content ?? []).map((c) => c.text ?? "").join("") : (j.choices?.[0]?.message?.content ?? "");
    const m = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
    const v = JSON.parse(m) as { decision?: string; reasons?: unknown };
    const reasons = Array.isArray(v.reasons) ? v.reasons.map((x) => String(x).slice(0, 300)).slice(0, 5) : [];
    return v.decision === "approve" ? { decision: "approve", reasons } : { decision: "review", reasons: reasons.length ? reasons : ["needs a human look"] };
  } catch (e) {
    return { decision: "review", reasons: [`screening failed: ${(e as Error).message.slice(0, 200)}`] };
  }
}

/** Open the campaign now: the period starts from this moment */
export async function startFunding(taskId: string, screening: Screening) {
  const t = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const now = new Date();
  const r = await db.task.updateMany({
    where: { id: taskId, status: { in: ["SCREENING"] } },
    data: { status: "FUNDING", deadlineAt: addDays(now, t.durationDays ?? 7), fundingStartedAt: now, screening: screening as unknown as Prisma.InputJsonValue },
  });
  if (r.count !== 1) return;
  await db.taskEvent.create({ data: { taskId, type: "funding.opened", message: `Crowdfunding opened: goal ${t.goalTwd} TWD, ${t.durationDays} days`, data: { goal: t.goalTwd, by: screening.by } } });
  await postStatus(taskId, `眾籌開始：目標 NT$${t.goalTwd}，期限 ${t.durationDays} 天。Crowdfunding is open: goal NT$${t.goalTwd}, ${t.durationDays} days.`, { notifyTitle: "眾籌開始 Crowdfunding open", type: "crowd.open" });
}

/** Called when the proposer submits (status SCREENING) */
export async function screenProposal(taskId: string) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const at = new Date().toISOString();
  if (config.crowd.screening === "off") return startFunding(taskId, { decision: "approve", reasons: [], by: "off", at });
  const ai = config.crowd.screening === "ai" ? await aiScreen(task) : { decision: "review" as const, reasons: ["manual screening"] };
  if (ai.decision === "approve") return startFunding(taskId, { decision: "approve", reasons: ai.reasons, by: "ai", at });
  await db.task.update({ where: { id: taskId }, data: { screening: { decision: "review", reasons: ai.reasons, by: "ai", at } as Prisma.InputJsonValue } });
  await db.taskEvent.create({ data: { taskId, type: "screening.review", message: `Waiting for review: ${ai.reasons.join("; ")}` } });
  await notify(task.userId, { type: "crowd.screening", title: `提案審核中 Under review: ${task.title}`, body: "平台會盡快審核你的提案，通過後立即開始眾籌並從那時起計算期限。The platform will review your proposal; the campaign period starts once it opens.", link: `/tasks/${taskId}` }).catch(() => undefined);
  const admins = await db.user.findMany({ where: { role: { in: ["ADMIN", "SUPERADMIN"] } }, select: { id: true } });
  for (const a of admins) await notify(a.id, { type: "crowd.screening", title: `眾籌提案待審核 Proposal to review: ${task.title}`, body: ai.reasons.join("\n"), link: "/admin?tab=screening" }).catch(() => undefined);
}

/** Admin decision on a proposal waiting for review */
export async function decideScreening(actorId: string, taskId: string, approve: boolean, note?: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.status !== "SCREENING") throw new HttpError(400, "this proposal is not waiting for review");
  const at = new Date().toISOString();
  await audit(actorId, approve ? "crowd.screening.approve" : "crowd.screening.reject", { type: "task", id: taskId }, { note: note ?? null });
  if (approve) return startFunding(taskId, { decision: "approve", reasons: note ? [note] : [], by: "admin", at });
  const reasons = [note?.trim() || "does not meet the content rules"];
  await db.task.update({ where: { id: taskId }, data: { status: "DRAFT", screening: { decision: "rejected", reasons, by: "admin", at } as Prisma.InputJsonValue } });
  await db.taskEvent.create({ data: { taskId, type: "screening.rejected", message: `Returned to draft: ${reasons[0]}` } });
  await notify(task.userId, { type: "crowd.screening_rejected", title: `提案需要修改 Needs changes: ${task.title}`, body: reasons[0], link: `/crowd/${taskId}/edit` }).catch(() => undefined);
}
