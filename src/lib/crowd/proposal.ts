import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { subscriptionState } from "../subscriptions";
import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { offeredModel, pricingSettings } from "../models";
import { cleanBuyer, createPayment, type Buyer } from "../payments";
import { BuyerInput } from "../buyer-schema";
import { deleteObject, putObject } from "../storage";
import { addDays } from "../retention";
import { postStatus } from "./agent";
import { CATEGORIES, EVAL_METHODS, feeRate, fileCost, minimumGoal, normalizeSpec, sharePrice, specGaps, specMarkdown, type Spec } from "./rules";
import type { Prisma, Task } from "@/generated/prisma/client";

/**
 * Crowdfunding proposals (Task.status DRAFT). The proposer only describes what they want and pays the proposal fee;
 * the model then drafts the whole spec (title, category, deliverables, method, acceptance criteria and the cost
 * estimate that sets the goal). The proposer edits it line by line or asks the model for changes, picks a period and
 * submits it for screening.
 */

export const DraftInput = z.object({
  /** optional: the model names the proposal when left empty */
  title: z.string().trim().max(120).optional().nullable(),
  /** what the proposer wants, in their own words (the model turns it into a spec) */
  description: z.string().trim().min(10).max(20_000),
  model: z.string().min(3).max(200),
  kind: z.enum(["TASK", "EVALUATION"]).default("TASK"),
  skillVersionId: z.string().optional().nullable(),
  /** evaluations: left empty, the model chooses the method and writes the criteria */
  evalMethod: z.enum(EVAL_METHODS).optional().nullable(),
  evalCriteria: z.string().trim().max(10_000).optional().nullable(),
});

/** The provisional title of a proposal created without one (replaced by the model's title) */
export function placeholderTitle(description: string): string {
  const first = description.trim().split("\n")[0].replace(/\s+/g, " ");
  const cps = [...first];
  return cps.length <= 40 ? first : cps.slice(0, 39).join("") + "…";
}

export async function createDraft(userId: string, raw: z.input<typeof DraftInput>) {
  const input = DraftInput.parse(raw);
  const model = await offeredModel(input.model);
  if (!model) throw new HttpError(400, "unsupported model");
  if (input.skillVersionId) {
    const sv = await db.skillVersion.findUnique({ where: { id: input.skillVersionId } });
    if (!sv || sv.status === "REVOKED" || sv.status === "REJECTED") throw new HttpError(400, "skill version not available");
  }
  const { fx, buffer } = await pricingSettings();
  const { currentChecklist } = await import("./checklist");
  const termsVersion = (await currentChecklist()).version;
  return db.task.create({
    data: {
      userId,
      kind: input.kind,
      crowdfund: true,
      status: "DRAFT",
      // crowdfunded tasks are always public: anyone can back them
      isPublic: true,
      title: input.title && input.title.length >= 3 ? input.title : placeholderTitle(input.description),
      termsVersion,
      prompt: input.description,
      model: input.model,
      skillVersionId: input.skillVersionId || null,
      evalMethod: input.kind === "EVALUATION" ? (input.evalMethod ?? null) : null,
      evalCriteria: input.kind === "EVALUATION" ? input.evalCriteria || null : null,
      usdTwdRate: fx,
      priceBuffer: buffer,
      modelPriceUsd: model.usd,
    },
  });
}

/** The proposer's own draft (or 404) */
export async function ownDraft(userId: string, taskId: string): Promise<Task> {
  const t = await db.task.findUnique({ where: { id: taskId } });
  if (!t || t.userId !== userId || !t.crowdfund) throw new HttpError(404, "proposal not found");
  if (t.status !== "DRAFT") throw new HttpError(400, "the proposal is already open for pledges");
  return t;
}

export const creditLeft = (t: Pick<Task, "proposalCreditTwd" | "proposalUsedTwd">) => Number(t.proposalCreditTwd) - Number(t.proposalUsedTwd);

/**
 * Subscribers pay no proposal fee (2026-10-23): while a paid subscription period runs, proposals start and the spec
 * dialogue and reference files are used without limit; the platform absorbs the cost (Task.proposalWaivedTwd).
 */
export async function feeWaived(userId: string, now = new Date()) {
  return !!(await subscriptionState(userId, now)).current;
}

/** The proposal may use the spec dialogue: a fee was paid, or the proposer is subscribed */
export const proposalPaid = (t: Pick<Task, "proposalCreditTwd">, waived: boolean) => waived || Number(t.proposalCreditTwd) > 0;

/** Charge one proposal fee to a saved card (the first one, or another when the credit ran out) */
export async function buyProposalFee(userId: string, taskId: string, buyer: Buyer, cardId: string) {
  await ownDraft(userId, taskId);
  if (await feeWaived(userId)) throw new HttpError(400, "subscribers start proposals without the proposal fee");
  return createPayment({ userId, purpose: "CROWD_PROPOSAL", amountTwd: Math.round(config.crowd.proposalFee), taskId, buyer, cardId });
}

/** Called once per confirmed CROWD_PROPOSAL payment */
export async function grantProposalCredit(taskId: string, amountTwd: number, paymentId: string) {
  await db.task.update({ where: { id: taskId }, data: { proposalCreditTwd: { increment: amountTwd } } });
  await db.taskEvent.create({ data: { taskId, type: "proposal.credit", message: `Proposal fee ${amountTwd} TWD confirmed (credit for the spec dialogue and storage)`, data: { payment: paymentId } } });
}

/**
 * Use proposal credit. Fails with 402 when the credit is not enough (spec dialogue turns are charged after the
 * fact, so `allowOverdraw` lets the last one finish).
 */
export async function useCredit(taskId: string, twd: number, opts: { allowOverdraw?: boolean } = {}) {
  if (!(twd > 0)) return;
  const amount = Math.ceil(twd * 1e6) / 1e6;
  const where: Prisma.TaskWhereInput = { id: taskId };
  const t = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  // subscribed proposer: nothing to run out of, the platform records what it absorbed
  if (await feeWaived(t.userId)) {
    await db.task.update({ where: { id: taskId }, data: { proposalWaivedTwd: { increment: amount } } });
    return;
  }
  if (!opts.allowOverdraw) {
    if (creditLeft(t) + 1e-9 < amount) throw new HttpError(402, "proposal credit used up — buy another proposal fee to continue");
    // conditional update: the credit cannot be spent twice by concurrent requests
    where.proposalUsedTwd = t.proposalUsedTwd;
  }
  const r = await db.task.updateMany({ where, data: { proposalUsedTwd: { increment: amount } } });
  if (r.count !== 1) throw new HttpError(409, "proposal credit changed, try again");
}

// ───────────── reference files ─────────────

export const FILE_VISIBILITY = ["PUBLIC", "BACKERS", "AGENT"] as const;

const safeName = (n: string) => n.replace(/[\\/]/g, "_").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(-120) || "file";

export async function addFile(userId: string, taskId: string, f: { filename: string; contentType: string; data: Buffer; visibility: (typeof FILE_VISIBILITY)[number] }) {
  const t = await ownDraft(userId, taskId);
  if (!f.data.length) throw new HttpError(400, "empty file");
  const stored = await db.taskInputFile.aggregate({ where: { taskId, deletedAt: null }, _sum: { sizeBytes: true }, _count: true });
  const before = Number(stored._sum.sizeBytes ?? 0);
  if (stored._count >= 50) throw new HttpError(400, "at most 50 reference files");
  if (before + f.data.length > config.crowd.maxFileBytes) throw new HttpError(413, `reference files are limited to ${Math.round(config.crowd.maxFileBytes / 1048576)} MB in total`);
  const cost = fileCost(before, f.data.length, Number(t.usdTwdRate));
  await useCredit(taskId, cost.total);
  const filename = safeName(f.filename);
  // the stored key stays ASCII; the original name lives in the row
  const key = `inputs/${taskId}/${randomBytes(12).toString("hex")}`;
  await putObject(key, f.data, f.contentType || "application/octet-stream");
  const row = await db.taskInputFile.create({
    data: { taskId, key, filename, contentType: (f.contentType || "application/octet-stream").slice(0, 100), sizeBytes: BigInt(f.data.length), sha256: createHash("sha256").update(f.data).digest("hex"), visibility: f.visibility },
  });
  return { file: row, cost };
}

/** Remove a file from a draft (the credit it used is not returned) */
export async function removeFile(userId: string, taskId: string, fileId: string) {
  await ownDraft(userId, taskId);
  const f = await db.taskInputFile.findUnique({ where: { id: fileId } });
  if (!f || f.taskId !== taskId || f.deletedAt) throw new HttpError(404, "file not found");
  await db.taskInputFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
  await deleteObject(f.key).catch(() => undefined);
}

/** May `viewerId` download this reference file? */
export async function canReadFile(task: Pick<Task, "id" | "userId">, file: { visibility: string }, viewerId?: string | null) {
  if (viewerId && viewerId === task.userId) return true;
  if (file.visibility === "PUBLIC") return true;
  if (file.visibility === "AGENT" || !viewerId) return false;
  return (await db.pledge.count({ where: { taskId: task.id, userId: viewerId, status: { in: ["ACTIVE", "CHARGED"] } } })) > 0;
}

// ───────────── spec ─────────────

/**
 * The proposer edits the spec by hand. Once the model has drafted it, the cost estimate and stretch goals stay the
 * model's (they set the goal); only the model changes them, through the dialogue.
 */
export async function saveSpec(userId: string, taskId: string, spec: unknown) {
  const t = await ownDraft(userId, taskId);
  const current = t.spec ? normalizeSpec(t.spec) : null;
  const input = normalizeSpec(spec);
  const s = current ? { ...input, estimate: current.estimate, stretch: current.stretch } : input;
  await db.task.update({ where: { id: taskId }, data: { spec: s as unknown as Prisma.InputJsonValue, specVersion: { increment: 1 } } });
  return s;
}

export const OpenInput = z.object({
  /** "crowd": a crowdfunding period; "self": the proposer pays the whole goal (charged when the screening passes) */
  mode: z.enum(["crowd", "self"]).default("crowd"),
  durationDays: z.coerce.number().int().optional(),
  goalTwd: z.coerce.number().int().positive().optional(),
  startEarly: z.boolean().default(false),
  /** self: the saved card to charge, the e-invoice buyer, and whether the task and its results are public */
  cardId: z.string().optional(),
  buyer: BuyerInput.optional(),
  isPublic: z.boolean().default(true),
});

/**
 * Submit the proposal for screening: spec complete, proposal fee paid. Crowdfunding: goal ≥ the minimum for the chosen
 * period, the period starts when the screening passes. Self-funded: the goal is the P90 estimate (no service fee) and
 * the proposer's card is charged in full when the screening passes; nobody else can pledge.
 */
export async function openFunding(userId: string, taskId: string, raw: z.input<typeof OpenInput>) {
  const input = OpenInput.parse(raw);
  const self = input.mode === "self";
  const t = await ownDraft(userId, taskId);
  if (!proposalPaid(t, await feeWaived(userId))) throw new HttpError(402, "pay the proposal fee first");
  const spec = t.spec ? normalizeSpec(t.spec) : null;
  const gaps = specGaps(spec);
  if (gaps.length) throw new HttpError(400, `the spec is missing: ${gaps.join(", ")}`);
  if (t.kind === "EVALUATION" && !t.evalMethod) throw new HttpError(400, "the spec is missing: evaluation method");
  if (!self && input.durationDays === undefined) throw new HttpError(400, "pick a crowdfunding period");
  const rate = self ? 0 : feeRate(input.durationDays!);
  const min = minimumGoal(spec!.estimate.p90Twd, rate);
  const goal = self ? min : (input.goalTwd ?? min);
  if (self) {
    const { usableCard } = await import("./cards");
    if (!input.cardId || !(await usableCard(userId, input.cardId))) throw new HttpError(400, "pick a saved card to pay with");
    if (!input.buyer) throw new HttpError(400, "buyer name and email are required for the e-invoice");
    await db.user.update({ where: { id: userId }, data: { billing: cleanBuyer(input.buyer as Buyer) as Prisma.InputJsonValue } });
  }
  if (goal % sharePrice() !== 0) throw new HttpError(400, `the goal must be a multiple of ${sharePrice()} TWD`);
  if (goal < min) throw new HttpError(400, `the goal must be at least ${min} TWD (P90 estimate plus the service fee)`);
  const now = new Date();
  // a proposal sent back by the screening keeps its description (the prompt is rebuilt from it)
  const description = t.prompt.startsWith(`# ${t.title}\n\n`) && t.prompt.includes("\n## Summary") ? t.prompt.split("\n## Summary")[0].replace(/^# .*\n\n/, "") : t.prompt;
  const r = await db.task.updateMany({
    where: { id: taskId, status: "DRAFT" },
    data: {
      status: "SCREENING",
      termsVersion: (await (await import("./checklist")).currentChecklist()).version,
      goalTwd: goal,
      durationDays: self ? null : input.durationDays,
      deadlineAt: null,
      startEarly: self ? false : input.startEarly,
      serviceFeeRate: rate,
      selfFunded: self,
      selfCardId: self ? input.cardId : null,
      isPublic: self ? input.isPublic : true,
      prompt: specMarkdown(t.title, description, spec as Spec),
    },
  });
  if (r.count !== 1) throw new HttpError(409, "the proposal changed, reload the page");
  await db.specRevision.deleteMany({ where: { taskId } });
  await db.specRevision.create({ data: { taskId, version: 1, spec: spec as unknown as Prisma.InputJsonValue, note: "opened" } });
  await db.task.update({ where: { id: taskId }, data: { specVersion: 1 } });
  await db.taskEvent.create({ data: { taskId, type: "funding.submitted", message: self ? `Submitted, paid in full by the proposer: ${goal} TWD` : `Submitted for crowdfunding: goal ${goal} TWD, ${input.durationDays} days`, data: { goal, rate, self } } });
  // the worker screens it against the checklist; the period starts when the campaign opens
  const { queueScreening, screenProposal } = await import("./screening");
  if (config.crowd.screening === "off") await screenProposal(taskId);
  else await queueScreening(taskId);
  return db.task.findUniqueOrThrow({ where: { id: taskId } });
}

// ───────────── revisions while funding ─────────────

/**
 * The proposer publishes a new spec version while the campaign is open. Backers are told and keep the right to
 * withdraw for crowd.exitHours hours; nothing is charged before that (the deadline moves if needed). The goal does
 * not change, so the new P90 estimate must still fit in it.
 */
export async function reviseSpec(userId: string, taskId: string, raw: unknown, note: string) {
  const t = await db.task.findUnique({ where: { id: taskId } });
  if (!t || t.userId !== userId || !t.crowdfund) throw new HttpError(404, "task not found");
  if (t.status !== "FUNDING") throw new HttpError(400, "the spec can only be revised while the campaign is open");
  const text = note.trim().slice(0, 2000);
  if (!text) throw new HttpError(400, "describe what changed");
  const spec = normalizeSpec(raw);
  const gaps = specGaps(spec);
  if (gaps.length) throw new HttpError(400, `the spec is missing: ${gaps.join(", ")}`);
  const min = minimumGoal(spec.estimate.p90Twd, Number(t.serviceFeeRate ?? 0));
  if (min > (t.goalTwd ?? 0)) throw new HttpError(400, `the new estimate needs a goal of at least ${min} TWD; the goal cannot change after opening`);
  const now = new Date();
  const exitUntil = new Date(now.getTime() + config.crowd.exitHours * 3600_000);
  const version = t.specVersion + 1;
  const description = t.prompt.split("\n## Summary")[0].replace(/^# .*\n\n/, "");
  await db.specRevision.create({ data: { taskId, version, spec: spec as unknown as Prisma.InputJsonValue, note: text } });
  await db.task.update({
    where: { id: taskId },
    data: {
      spec: spec as unknown as Prisma.InputJsonValue,
      specVersion: version,
      prompt: specMarkdown(t.title, description, spec),
      exitUntil,
      ...(t.deadlineAt && t.deadlineAt < exitUntil ? { deadlineAt: exitUntil } : {}),
    },
  });
  await db.taskEvent.create({ data: { taskId, type: "spec.revised", message: `Spec revised to v${version}: ${text}`, data: { version } } });
  await postStatus(
    taskId,
    `規格已修訂為第 ${version} 版：${text}\n${config.crowd.exitHours} 小時內不會請款，不同意的出資者可以撤回出資。The spec was revised to v${version}. Nothing is charged for ${config.crowd.exitHours} hours; backers who disagree can withdraw.`,
    { notifyTitle: "規格已修訂 Spec revised", type: "crowd.revised" },
  );
  return db.task.findUniqueOrThrow({ where: { id: taskId } });
}

export const DraftUpdate = z.object({ title: z.string().trim().min(3).max(120).optional(), category: z.enum(CATEGORIES).nullable().optional() });

/** Rename or recategorise a draft */
export async function updateDraft(userId: string, taskId: string, input: z.infer<typeof DraftUpdate>) {
  await ownDraft(userId, taskId);
  return db.task.update({ where: { id: taskId }, data: { ...(input.title ? { title: input.title } : {}), ...(input.category !== undefined ? { category: input.category } : {}) } });
}
