import { db } from "../db";
import { config } from "../config";
import { notify } from "../notify";
import { addDays } from "../retention";
import { mockAllowed } from "../payment-mode";
import { CARD_ERRORS, OenError, chargeToken, orderTransactions, PAID, refundTransaction, type OenInvoice, type OenProduct } from "../oen";
import type { Payment, Task } from "@/generated/prisma/client";
import { postStatus } from "./agent";
import { cardToken, latestCard } from "./cards";
import { bookPoints } from "./points";
import { releasePledge, returnQuota } from "./pledges";
import { serviceFee, sharePrice } from "./rules";

/**
 * Crowdfunding lifecycle (run by the worker every minute through crowdTick; pledges and card bindings also nudge it):
 *
 *   FUNDING ──deadline, pledged ≥ goal (or start early and the goal is reached)──▶ CHARGING
 *   FUNDING ──deadline, short of the goal──▶ UNFUNDED: nothing charged, points / quota given back
 *   CHARGING: one card charge per backer (token, idempotent). Declined cards are retried daily and right after the
 *             backer saves a new card, until the grace period ends.
 *   CHARGING ──collected ≥ goal──▶ QUEUED (fee taken, unused proposal credit added, the run starts)
 *   CHARGING ──grace over, collected < goal──▶ UNFUNDED: charged cards refunded in full, points / quota given back
 *   COMPLETED / FAILED / CANCELLED ──▶ settled: the backers' share of the leftover becomes points (quota pledges get
 *             quota back); the part that came from the proposal fee stays with the platform.
 */

const RETRY_MS = 24 * 3600_000;
const num = (v: unknown) => Number(String(v ?? 0));

async function event(taskId: string, type: string, message: string, data?: object) {
  await db.taskEvent.create({ data: { taskId, type, message, data: data ?? undefined } });
}

// ───────────── card charges ─────────────

function pledgeProduct(title: string, shares: number): OenProduct {
  return { productionCode: "CROWD-PLEDGE", description: `眾籌出資：${title.slice(0, 40)}`, quantity: shares, unit: "份", unitPrice: sharePrice() };
}

type ChargeResult = { ok: true; hid: string } | { ok: false; code: string; message: string; unknown?: boolean };

async function sendCharge(pay: Payment, token: string, task: Task, shares: number, buyer: { name?: string; email?: string; invoice?: OenInvoice } | null): Promise<ChargeResult> {
  if (pay.provider === "MOCK") {
    if (token.startsWith("mock_decline")) return { ok: false, code: "T0005", message: "declined (mock)" };
    return { ok: true, hid: `PMOCK${pay.id.slice(-12)}` };
  }
  try {
    const r = await chargeToken({
      token,
      amount: pay.amountTwd!,
      orderId: pay.id,
      product: pledgeProduct(task.title, shares),
      idempotencyKey: `crowd-pledge-${pay.id}`,
      userId: pay.userId,
      userName: buyer?.name,
      userEmail: buyer?.email,
      invoiceInfo: buyer?.invoice,
    });
    return { ok: true, hid: r.id };
  } catch (e) {
    if (e instanceof OenError && (CARD_ERRORS.has(e.code) || e.code.startsWith("V"))) return { ok: false, code: e.code, message: e.message };
    // timeouts, 5xx, C026, I000x: the result is unknown; look the order up before trying again
    return { ok: false, code: e instanceof OenError ? e.code : "NETWORK", message: (e as Error).message, unknown: true };
  }
}

async function chargeSucceeded(pay: Payment, hid: string) {
  const won = await db.payment.updateMany({ where: { id: pay.id, status: "PENDING" }, data: { status: "CONFIRMED", transactionHid: hid, providerStatus: "charged", paidAt: new Date(), confirmedAt: new Date(), error: null } });
  if (won.count !== 1) return;
  await db.pledge.updateMany({ where: { paymentId: pay.id }, data: { status: "CHARGED", chargedAt: new Date(), error: null } });
  await event(pay.taskId!, "pledge.charged", `Card pledge charged: ${pay.amountTwd} TWD`, { payment: pay.id, transaction: hid });
  const task = await db.task.findUniqueOrThrow({ where: { id: pay.taskId! } });
  if (task.fundedAt) await addToBudget(task, pay.amountTwd!);
}

async function chargeFailed(pay: Payment, code: string, message: string) {
  const r = await db.payment.updateMany({ where: { id: pay.id, status: "PENDING" }, data: { status: "FAILED", error: `${code}: ${message}`.slice(0, 500), providerStatus: "failed" } });
  if (r.count !== 1) return;
  await db.pledge.updateMany({ where: { paymentId: pay.id }, data: { status: "FAILED", error: code } });
  const earlier = await db.payment.count({ where: { taskId: pay.taskId, userId: pay.userId, purpose: "CROWD_PLEDGE", status: "FAILED", id: { not: pay.id } } });
  if (!earlier) {
    const task = await db.task.findUnique({ where: { id: pay.taskId! }, select: { title: true, chargeDeadlineAt: true } });
    await notify(pay.userId, {
      type: "crowd.charge_failed",
      title: `出資扣款失敗 Card declined: ${task?.title ?? ""}`,
      body: `信用卡扣款未成功（${code}）。請在帳戶設定新增另一張卡，我們會自動重試${task?.chargeDeadlineAt ? `，期限 ${task.chargeDeadlineAt.toISOString().slice(0, 10)}` : ""}。\nYour card was declined (${code}). Add another card in your account and we will retry automatically.`,
      link: "/account#cards",
    }).catch(() => undefined);
  }
}

/** Look up an attempt whose outcome was unknown */
async function resolvePending(pay: Payment): Promise<"settled" | "pending"> {
  if (pay.provider === "MOCK") {
    await chargeFailed(pay, "UNKNOWN", "mock attempt abandoned");
    return "settled";
  }
  try {
    const txs = (await orderTransactions(pay.id)).filter((t) => t.orderId === pay.id);
    const paid = txs.find((t) => PAID.has(t.status));
    if (paid) {
      await chargeSucceeded(pay, paid.id);
      return "settled";
    }
    if (txs.some((t) => t.status === "failed")) {
      await chargeFailed(pay, "T0001", "declined");
      return "settled";
    }
    // no transaction at all after 10 minutes: the request never reached the bank, safe to try again
    if (!txs.length && Date.now() - pay.createdAt.getTime() > 10 * 60_000) {
      await chargeFailed(pay, "NO_RESULT", "no transaction was created");
      return "settled";
    }
  } catch (e) {
    console.warn("crowd resolve", pay.id, (e as Error).message);
  }
  return "pending";
}

/** Charge one backer's card pledges on a task (all of them in one transaction) */
export async function chargeBacker(taskId: string, userId: string) {
  const pending = await db.payment.findFirst({ where: { taskId, userId, purpose: "CROWD_PLEDGE", status: "PENDING" } });
  if (pending && (await resolvePending(pending)) === "pending") return;
  const pledges = await db.pledge.findMany({ where: { taskId, userId, source: "CARD", status: { in: ["ACTIVE", "FAILED"] } } });
  if (!pledges.length) return;
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const card = await latestCard(userId);
  if (!card) {
    await db.pledge.updateMany({ where: { id: { in: pledges.map((p) => p.id) } }, data: { status: "FAILED", error: "NO_CARD" } });
    return;
  }
  const amount = pledges.reduce((a, p) => a + p.amountTwd, 0);
  const shares = pledges.reduce((a, p) => a + p.shares, 0);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const buyer = (user.billing ?? null) as { name?: string; email?: string; invoice?: OenInvoice } | null;
  const mock = mockAllowed() || card.bindingId.startsWith("mock_");
  const pay = await db.payment.create({
    data: {
      userId, taskId, purpose: "CROWD_PLEDGE", provider: mock ? "MOCK" : "OEN",
      amount, amountTwd: amount, amountBase: String(amount), token: "TWD", recipient: mock ? "mock" : config.oen.merchantId,
      buyer: (buyer ?? undefined) as object | undefined, meta: { card: card.id, last4: card.last4 },
    },
  });
  await db.pledge.updateMany({ where: { id: { in: pledges.map((p) => p.id) } }, data: { paymentId: pay.id, cardId: card.id } });
  const r = await sendCharge(pay, cardToken(card), task, shares, buyer);
  if (r.ok) await chargeSucceeded(pay, r.hid);
  else if (r.unknown) await db.payment.update({ where: { id: pay.id }, data: { error: `${r.code}: ${r.message}`.slice(0, 500) } });
  else await chargeFailed(pay, r.code, r.message);
}

async function chargeDue(task: Task, now: Date) {
  // declined pledges are retried daily, and only until the grace period ends
  const retry = !task.chargeDeadlineAt || task.chargeDeadlineAt > now;
  const due = await db.pledge.findMany({
    where: { taskId: task.id, source: "CARD", OR: [{ status: "ACTIVE" }, ...(retry ? [{ status: "FAILED" as const, updatedAt: { lt: new Date(now.getTime() - RETRY_MS) } }] : [])] },
    select: { userId: true },
    distinct: ["userId"],
  });
  const pendingUsers = await db.payment.findMany({ where: { taskId: task.id, purpose: "CROWD_PLEDGE", status: "PENDING" }, select: { userId: true }, distinct: ["userId"] });
  for (const u of new Set([...due.map((d) => d.userId), ...pendingUsers.map((p) => p.userId)])) {
    await chargeBacker(task.id, u).catch((e) => console.warn("crowd charge", task.id, u, (e as Error).message));
  }
}

/** A backer saved a new card: retry their declined pledges now */
export async function retryBacker(userId: string) {
  const tasks = await db.pledge.findMany({ where: { userId, source: "CARD", status: "FAILED", task: { status: { in: ["CHARGING", "QUEUED", "RUNNING", "NEEDS_FUNDING"] } } }, select: { taskId: true }, distinct: ["taskId"] });
  for (const t of tasks) await chargeBacker(t.taskId, userId).catch(() => undefined);
}

// ───────────── budget ─────────────

/** Money collected after funding (late card charges, late points / quota pledges) joins the budget minus the fee */
async function addToBudget(task: Task, amount: number) {
  const fee = serviceFee(amount, num(task.serviceFeeRate));
  await db.task.update({ where: { id: task.id }, data: { budget: { increment: amount - fee }, serviceFeeTwd: { increment: fee } } });
  const resume = await db.task.updateMany({ where: { id: task.id, status: "NEEDS_FUNDING" }, data: { status: "QUEUED", fundingRequestedAt: null } });
  await event(task.id, "budget.added", `Budget +${amount - fee} TWD (service fee ${fee} TWD)`);
  if (resume.count) await postStatus(task.id, `追加經費已到位，繼續執行。Funds added, the run continues.`);
}

/** A pledge made after charging began: collect it now */
export async function collectLate(taskId: string, pledgeId: string) {
  const p = await db.pledge.findUniqueOrThrow({ where: { id: pledgeId } });
  if (p.source === "CARD") return chargeBacker(taskId, p.userId);
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (!task.fundedAt) return; // CHARGING: points / quota count toward the goal as they are
  const r = await db.pledge.updateMany({ where: { id: p.id, status: "ACTIVE" }, data: { status: "CHARGED", chargedAt: new Date() } });
  if (r.count === 1) await addToBudget(task, p.amountTwd);
}

// ───────────── campaign transitions ─────────────

async function beginCharging(task: Task, now: Date, why: string) {
  const r = await db.task.updateMany({ where: { id: task.id, status: "FUNDING" }, data: { status: "CHARGING", chargeDeadlineAt: addDays(now, config.crowd.chargeGraceDays) } });
  if (r.count !== 1) return;
  await event(task.id, "funding.goal", why);
  await postStatus(task.id, `眾籌達標，開始向出資者請款。The goal is reached; charging backers now.`, { notifyTitle: "眾籌達標 Goal reached", type: "crowd.goal" });
  await chargeDue({ ...task, status: "CHARGING" }, now);
  await finishCharging(task.id, now);
}

/** Start-early campaigns go to charging as soon as the pledges reach the goal */
export async function maybeStartEarly(taskId: string, now = new Date()) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.status !== "FUNDING" || !task.startEarly || !task.goalTwd) return;
  const pledged = await db.pledge.aggregate({ where: { taskId, status: "ACTIVE" }, _sum: { amountTwd: true } });
  if ((pledged._sum.amountTwd ?? 0) >= task.goalTwd) await beginCharging(task, now, "Goal reached before the deadline (start early)");
}

async function collected(taskId: string) {
  const card = await db.pledge.aggregate({ where: { taskId, source: "CARD", status: "CHARGED" }, _sum: { amountTwd: true } });
  const other = await db.pledge.aggregate({ where: { taskId, source: { in: ["POINTS", "QUOTA"] }, status: { in: ["ACTIVE", "CHARGED"] } }, _sum: { amountTwd: true } });
  return (card._sum.amountTwd ?? 0) + (other._sum.amountTwd ?? 0);
}

async function fund(task: Task, now: Date) {
  const got = await collected(task.id);
  const rate = num(task.serviceFeeRate);
  const fee = serviceFee(got, rate);
  const proposalLeft = Math.max(0, num(task.proposalCreditTwd) - num(task.proposalUsedTwd));
  const r = await db.task.updateMany({
    where: { id: task.id, status: "CHARGING" },
    data: { status: "QUEUED", fundedAt: now, budget: got - fee + proposalLeft, serviceFeeTwd: fee, proposalToBudgetTwd: proposalLeft, proposalUsedTwd: { increment: proposalLeft } },
  });
  if (r.count !== 1) return;
  await db.pledge.updateMany({ where: { taskId: task.id, source: { in: ["POINTS", "QUOTA"] }, status: "ACTIVE" }, data: { status: "CHARGED", chargedAt: now } });
  await event(task.id, "funding.funded", `Funded: collected ${got} TWD, service fee ${fee} TWD, unused proposal credit ${proposalLeft.toFixed(2)} TWD added`, { collected: got, fee, proposalLeft });
  await postStatus(task.id, `募資完成：實收 NT$${got}，任務已排入執行。Funded with NT$${got}; the task is queued.`, { notifyTitle: "募資完成 Funded", type: "crowd.funded" });
}

async function failCampaign(task: Task, reason: string) {
  const r = await db.task.updateMany({ where: { id: task.id, status: { in: ["FUNDING", "CHARGING"] } }, data: { status: "UNFUNDED", finishedAt: new Date() } });
  if (r.count !== 1) return;
  // charged cards: full refund (one refund per transaction, so the whole amount at once)
  const paid = await db.payment.findMany({ where: { taskId: task.id, purpose: "CROWD_PLEDGE", status: "CONFIRMED", refundedTwd: 0 } });
  for (const pay of paid) {
    try {
      if (pay.provider === "OEN" && pay.transactionHid) {
        const shares = Math.round((pay.amountTwd ?? 0) / sharePrice());
        await refundTransaction(pay.transactionHid, { amount: pay.amountTwd!, reason: "crowdfunding did not reach its goal", product: pledgeProduct(task.title, shares) });
      }
      await db.payment.update({ where: { id: pay.id }, data: { status: "REFUNDED", refundedTwd: pay.amountTwd ?? 0, refundedAt: new Date(), refundReason: "crowdfunding not funded" } });
      await db.pledge.updateMany({ where: { paymentId: pay.id }, data: { status: "REFUNDED" } });
    } catch (e) {
      await event(task.id, "refund.failed", `Refund of ${pay.amountTwd} TWD failed, an admin must refund it: ${(e as Error).message}`, { payment: pay.id });
    }
  }
  const open = await db.pledge.findMany({ where: { taskId: task.id, status: { in: ["ACTIVE", "FAILED"] } } });
  for (const p of open) await releasePledge(p.id, "RELEASED");
  await event(task.id, "funding.unfunded", reason);
  await postStatus(task.id, `眾籌未達標，未向任何人扣款（已扣款者全額退刷，點數與額度已退回）。The campaign did not reach its goal: nothing is charged; charged cards are refunded and points or quota returned.`, { notifyTitle: "眾籌未達標 Not funded", type: "crowd.unfunded" });
}

async function finishCharging(taskId: string, now: Date) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (task.status !== "CHARGING") return;
  const got = await collected(taskId);
  if (got >= (task.goalTwd ?? 0)) return fund(task, now);
  if (task.chargeDeadlineAt && task.chargeDeadlineAt <= now) await failCampaign(task, `Collected ${got} of ${task.goalTwd} TWD when the charging grace period ended`);
}

// ───────────── settlement ─────────────

/** Leftover → points (card / points pledges) or quota (quota pledges), in proportion to what each pledge put in */
export async function settleTask(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task?.crowdfund || !task.fundedAt || task.settledAt || !["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return;
  const claim = await db.task.updateMany({ where: { id: taskId, settledAt: null }, data: { settledAt: new Date() } });
  if (claim.count !== 1) return;
  const leftover = Math.floor(num(task.budget) - Math.ceil(num(task.charged)));
  if (leftover <= 0) {
    await event(taskId, "settled", "Settled: no leftover budget");
    return;
  }
  const rate = num(task.serviceFeeRate);
  const pledges = await db.pledge.findMany({ where: { taskId, status: "CHARGED" } });
  const nets = pledges.map((p) => ({ p, net: p.amountTwd - p.amountTwd * rate }));
  const pledgeNet = nets.reduce((a, x) => a + x.net, 0);
  const fromProposal = num(task.proposalToBudgetTwd);
  if (pledgeNet <= 0) return;
  const forBackers = leftover * (pledgeNet / (pledgeNet + fromProposal));
  let given = 0;
  for (const { p, net } of nets) {
    const share = Math.floor(forBackers * (net / pledgeNet));
    if (share <= 0) continue;
    if (p.source === "QUOTA") await returnQuota(p.userId, share, p.id);
    else await bookPoints({ userId: p.userId, delta: share, reason: "leftover", ref: `leftover:${p.id}`, taskId, note: task.title.slice(0, 100) });
    await db.pledge.update({ where: { id: p.id }, data: { returnedTwd: share } });
    given += share;
  }
  await event(taskId, "settled", `Settled: ${given} TWD of the ${leftover} TWD leftover returned to backers as points / quota`, { leftover, given });
  await postStatus(taskId, `任務結算：剩餘經費 NT$${given} 已依出資比例轉為平台點數（額度出資者退回額度）。Settled: NT$${given} of unused budget went back to backers as points (quota pledges got quota back).`, { notifyTitle: "剩餘經費轉為點數 Leftover returned", type: "crowd.settled" });
}

// ───────────── the tick ─────────────

export async function crowdTick(now = new Date()) {
  // 1. campaigns at their deadline
  const ending = await db.task.findMany({ where: { status: "FUNDING", deadlineAt: { lte: now } }, take: 50 });
  for (const t of ending) {
    const pledged = await db.pledge.aggregate({ where: { taskId: t.id, status: "ACTIVE" }, _sum: { amountTwd: true } });
    if ((pledged._sum.amountTwd ?? 0) >= (t.goalTwd ?? Infinity)) await beginCharging(t, now, "Deadline reached with the goal met");
    else await failCampaign(t, `Deadline reached with ${pledged._sum.amountTwd ?? 0} of ${t.goalTwd} TWD pledged`);
  }
  // 2. start-early campaigns that reached the goal
  const early = await db.task.findMany({ where: { status: "FUNDING", startEarly: true }, select: { id: true }, take: 100 });
  for (const t of early) await maybeStartEarly(t.id, now);
  // 3. charging: retry, then fund or fail
  const charging = await db.task.findMany({ where: { status: "CHARGING" }, take: 50 });
  for (const t of charging) {
    await chargeDue(t, now);
    await finishCharging(t.id, now);
  }
  // 4. funded tasks with late or declined card pledges inside the grace period
  const late = await db.task.findMany({
    where: {
      crowdfund: true,
      fundedAt: { not: null },
      status: { in: ["QUEUED", "RUNNING", "NEEDS_FUNDING"] },
      OR: [{ pledges: { some: { source: "CARD", status: "ACTIVE" } } }, { chargeDeadlineAt: { gt: now }, pledges: { some: { source: "CARD", status: "FAILED" } } }],
    },
    take: 50,
  });
  for (const t of late) await chargeDue(t, now);
  // 5. finished tasks not settled yet
  const done = await db.task.findMany({ where: { crowdfund: true, fundedAt: { not: null }, settledAt: null, status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } }, select: { id: true }, take: 50 });
  for (const t of done) await settleTask(t.id);
  return { ended: ending.length, charging: charging.length, settled: done.length };
}
