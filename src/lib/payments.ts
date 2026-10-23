import { db } from "./db";
import { config } from "./config";
import { HttpError } from "./errors";
import { notify } from "./notify";
import { audit } from "./roles";
import { mockAllowed, simulatedCard } from "./payment-mode";
export { mockAllowed };
import { CARD_ERRORS, DEAD, OenError, PAID, REFUNDED, chargeToken, getTransaction, orderTransactions, refundTransaction, type OenInvoice, type OenProduct, type OenTransaction } from "./oen";
import { addPeriod, assertPlanBuyable, cancelPeriod } from "./subscriptions";
import type { Payment, PaymentPurpose, Prisma } from "@/generated/prisma/client";

/**
 * Payments through Oen (TWD, whole dollars), always with a saved card.
 *
 *  1. The buyer binds a card once (src/lib/crowd/cards.ts, Oen token checkout with 3-D Secure).
 *  2. createPayment: a PENDING Payment row (its id is Oen's orderId) charged right away with the chosen card's token
 *     (POST /token/transactions, Idempotency-Key = payment id). The response decides: charged → CONFIRMED and
 *     granted; declined → FAILED; no answer → stays PENDING and reconcilePayments looks the order up.
 *  3. Granting is idempotent: the PENDING → CONFIRMED update succeeds once, and only that caller grants the proposal
 *     credit or the subscription period (card pledges are charged by the crowdfunding lifecycle).
 *  4. refundPayment (admin): one Oen refund per transaction; returns a pledge or cancels the period.
 * Payments made in test mode (sandbox) go to Oen's testing environment and stay there for lookups and refunds.
 */

export type Buyer = { name: string; email: string; invoice?: OenInvoice };

const PRODUCT: Record<PaymentPurpose, { code: string; zh: string }> = {
  SUBSCRIPTION: { code: "SUB", zh: "SinoBee.ai 訂閱" },
  CROWD_PROPOSAL: { code: "CROWD-PROPOSAL", zh: "眾籌提案費" },
  CROWD_PLEDGE: { code: "CROWD-PLEDGE", zh: "眾籌出資" },
};


function product(pay: { purpose: PaymentPurpose; planCode?: string | null; planName?: string | null; days?: number }, amount: number): OenProduct {
  const p = PRODUCT[pay.purpose];
  return {
    productionCode: pay.purpose === "SUBSCRIPTION" && pay.planCode ? `${p.code}-${pay.planCode.toUpperCase()}` : p.code,
    description: pay.purpose === "SUBSCRIPTION" && pay.planName ? `${p.zh}（${pay.planName}，${pay.days ?? 30} 天）` : p.zh,
    quantity: 1,
    unit: pay.purpose === "SUBSCRIPTION" ? "期" : "式",
    unitPrice: amount,
  };
}

export function cleanBuyer(b: Buyer): Buyer {
  const name = b.name.trim().slice(0, 60);
  const email = b.email.trim().toLowerCase();
  if (!name) throw new HttpError(400, "buyer name is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "a valid email is required for the e-invoice");
  const inv = b.invoice;
  if (inv?.invoiceType === "company") {
    if (!/^\d{8}$/.test(inv.buyerIdentifier)) throw new HttpError(400, "統一編號 must be 8 digits");
    return { name, email, invoice: { invoiceType: "company", buyerIdentifier: inv.buyerIdentifier, buyerName: inv.buyerName?.trim() || undefined, email } };
  }
  if (inv?.invoiceType === "cloud" && inv.carrierType === "3J0002") {
    if (!/^\/[0-9A-Z.+-]{7}$/.test(inv.carrierId ?? "")) throw new HttpError(400, "mobile barcode must be / plus 7 characters");
    return { name, email, invoice: { invoiceType: "cloud", carrierType: "3J0002", carrierId: inv.carrierId, email } };
  }
  if (inv?.invoiceType === "cloud" && inv.carrierType === "CQ0001") {
    if (!/^[A-Z]{2}\d{14}$/.test(inv.carrierId ?? "")) throw new HttpError(400, "citizen certificate carrier must be 2 letters + 14 digits");
    return { name, email, invoice: { invoiceType: "cloud", carrierType: "CQ0001", carrierId: inv.carrierId, email } };
  }
  return { name, email, invoice: { invoiceType: "cloud", carrierType: "", email } };
}

/**
 * Create a payment and charge the chosen saved card. Resolves with the payment once the charge is confirmed (or
 * still unknown: status PENDING); rejects with 402 when the card is declined.
 */
export async function createPayment(p: { userId: string; purpose: PaymentPurpose; amountTwd: number; taskId?: string; planId?: string; buyer: Buyer; cardId: string; meta?: Record<string, string | number | boolean> }) {
  if (!Number.isInteger(p.amountTwd) || p.amountTwd < 1) throw new HttpError(400, "amount must be a whole TWD amount");
  const buyer = cleanBuyer(p.buyer);
  const plan = p.planId ? await db.plan.findUnique({ where: { id: p.planId } }) : null;
  if (p.purpose === "SUBSCRIPTION") assertPlanBuyable(plan && { active: plan.active, feeTwd: Number(plan.feeTwd) });
  const { usableCard, cardToken } = await import("./crowd/cards");
  const card = await usableCard(p.userId, p.cardId);
  const mock = simulatedCard(card);
  const pay = await db.payment.create({
    data: {
      userId: p.userId,
      purpose: p.purpose,
      taskId: p.taskId ?? null,
      planId: plan?.id ?? null,
      provider: mock ? "MOCK" : "OEN",
      sandbox: card.sandbox,
      cardId: card.id,
      amount: p.amountTwd,
      amountTwd: p.amountTwd,
      amountBase: String(p.amountTwd),
      token: "TWD",
      recipient: mock ? "mock" : config.oen.for(card.sandbox).merchantId,
      buyer: buyer as Prisma.InputJsonValue,
      meta: { ...(p.meta ?? {}), card: card.id, last4: card.last4 },
    },
  });
  await db.user.update({ where: { id: p.userId }, data: { billing: buyer as Prisma.InputJsonValue } });
  const token = cardToken(card);
  let result: { ok: true; hid: string } | { ok: false; code: string; message: string; unknown?: boolean };
  if (mock) result = token.startsWith("mock_decline") ? { ok: false, code: "T0005", message: "declined (mock)" } : { ok: true, hid: `PMOCK${pay.id.slice(-12)}` };
  else {
    try {
      const r = await chargeToken({
        token,
        amount: p.amountTwd,
        orderId: pay.id,
        product: product({ purpose: p.purpose, planCode: plan?.code, planName: plan?.name, days: plan?.days }, p.amountTwd),
        idempotencyKey: `pay-${pay.id}`,
        userId: p.userId,
        userName: buyer.name,
        userEmail: buyer.email,
        invoiceInfo: buyer.invoice,
        sandbox: card.sandbox,
      });
      result = { ok: true, hid: r.id };
    } catch (e) {
      const declined = e instanceof OenError && (CARD_ERRORS.has(e.code) || e.code.startsWith("V"));
      result = { ok: false, code: e instanceof OenError ? e.code : "NETWORK", message: (e as Error).message, unknown: !declined };
    }
  }
  if (result.ok) {
    await confirmCharge(pay.id, result.hid);
    return db.payment.findUniqueOrThrow({ where: { id: pay.id } });
  }
  if (result.unknown) {
    // the outcome is unknown: reconcilePayments looks the order up (never charge twice)
    return db.payment.update({ where: { id: pay.id }, data: { error: `${result.code}: ${result.message}`.slice(0, 500) } });
  }
  await db.payment.update({ where: { id: pay.id }, data: { status: "FAILED", providerStatus: "failed", error: `${result.code}: ${result.message}`.slice(0, 500) } });
  throw new HttpError(402, `the card was declined (${result.code}); try another card`);
}

/** A token charge went through: confirm once and grant what it buys */
async function confirmCharge(paymentId: string, hid: string) {
  const now = new Date();
  const won = await db.payment.updateMany({ where: { id: paymentId, status: { in: ["PENDING", "EXPIRED", "FAILED"] } }, data: { status: "CONFIRMED", transactionHid: hid, providerStatus: "charged", paidAt: now, confirmedAt: now, error: null } });
  if (won.count === 1) await grant(paymentId);
}

/** Does this Oen transaction belong to this payment? (webhooks are unsigned, so every field is checked) */
function matches(pay: Payment, tx: OenTransaction) {
  return tx.orderId === pay.id && Number(tx.amount) === pay.amountTwd && (!pay.oenId || tx.transactionId === pay.oenId || tx.id === pay.transactionHid);
}

/**
 * Apply what Oen reports for one of our payments. Safe to call any number of times, in any order.
 * Returns the payment as it is afterwards.
 */
export async function applyTransaction(pay: Payment, tx: OenTransaction): Promise<Payment> {
  if (!matches(pay, tx)) {
    await audit(null, "payment.mismatch", { type: "payment", id: pay.id }, { orderId: tx.orderId, amount: tx.amount, transactionId: tx.transactionId, expected: { amount: pay.amountTwd, oenId: pay.oenId } });
    throw new HttpError(409, "transaction does not match this payment");
  }
  const seen = { providerStatus: tx.status, ...(tx.transactionId && !pay.oenId ? { oenId: tx.transactionId } : {}), ...(tx.id && !pay.transactionHid ? { transactionHid: tx.id } : {}) };
  if (PAID.has(tx.status) || (REFUNDED.has(tx.status) && pay.status !== "CONFIRMED" && pay.status !== "REFUNDED")) {
    // paid (a refunded transaction was paid first); late payments after EXPIRED/FAILED still count
    await markPaid(pay, tx, seen);
  } else if (DEAD.has(tx.status)) {
    await db.payment.updateMany({ where: { id: pay.id, status: "PENDING" }, data: { status: "FAILED", error: tx.reason ?? tx.status, ...seen } });
  } else {
    await db.payment.update({ where: { id: pay.id }, data: seen });
  }
  if (REFUNDED.has(tx.status) && (tx.refundAmount ?? 0) > 0) {
    const now = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
    // refund made in the Oen CRM (or our record was interrupted): record it once
    if (now.refundedTwd === 0) await recordRefund(now, Number(tx.refundAmount), "refunded in Oen", null);
  }
  return db.payment.findUniqueOrThrow({ where: { id: pay.id } });
}

async function markPaid(pay: Payment, tx: OenTransaction, seen: object) {
  const paidAt = tx.paidAt ? new Date(tx.paidAt) : new Date();
  const won = await db.payment.updateMany({
    where: { id: pay.id, status: { in: ["PENDING", "EXPIRED", "FAILED"] } },
    data: { status: "CONFIRMED", confirmedAt: new Date(), paidAt, error: null, ...seen },
  });
  if (won.count === 1) await grant(pay.id);
  else await db.payment.update({ where: { id: pay.id }, data: seen });
}

/** What a confirmed payment buys. Runs once per payment (guarded by markPaid). */
async function grant(paymentId: string) {
  const pay = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (pay.purpose === "SUBSCRIPTION") {
    const plan = pay.planId ? await db.plan.findUnique({ where: { id: pay.planId } }) : null;
    // an automatic renewal continues the period it renews even when the charge is confirmed after that period ended
    const meta = (pay.meta ?? {}) as { autoRenew?: boolean; after?: string };
    const sub = await addPeriod(pay.userId, pay.id, { id: plan?.id ?? "", code: plan?.code ?? "legacy", days: plan?.days ?? 30 }, meta.autoRenew && meta.after ? { after: new Date(meta.after) } : {});
    await notify(pay.userId, {
      type: "subscription.active",
      title: `訂閱已生效 Subscription active: ${plan?.name ?? ""}`,
      body: `${sub.startsAt.toISOString().slice(0, 10)} – ${sub.endsAt.toISOString().slice(0, 10)}`,
      link: "/account#subscription",
    });
    return;
  }
  if (!pay.taskId) return;
  if (pay.purpose === "CROWD_PROPOSAL") {
    const { grantProposalCredit } = await import("./crowd/proposal");
    return grantProposalCredit(pay.taskId, pay.amountTwd ?? 0, pay.id);
  }
  // card pledges are booked by the crowdfunding charge itself (src/lib/crowd/lifecycle.ts)
}

/** Re-read one payment from Oen (return page, webhook, admin "check now") */
export async function syncPayment(paymentId: string): Promise<Payment> {
  const pay = await db.payment.findUnique({ where: { id: paymentId } });
  if (!pay) throw new HttpError(404, "payment not found");
  if (pay.provider !== "OEN") return pay;
  if (pay.oenId) return applyTransaction(pay, await getTransaction(pay.oenId, pay.sandbox));
  // card token charges have no transaction id of their own: find the order's transaction
  const txs = (await orderTransactions(pay.id, pay.sandbox)).filter((t) => t.orderId === pay.id);
  const tx = txs.find((t) => pay.transactionHid && t.id === pay.transactionHid) ?? txs.find((t) => PAID.has(t.status) || REFUNDED.has(t.status)) ?? txs[0];
  return tx ? applyTransaction(pay, tx) : pay;
}

/**
 * Webhook body → which payment to re-check. Unknown ids are ignored without calling Oen, so forged posts cost
 * nothing; known ids are re-read from Oen (the body itself is never trusted).
 */
export async function handleWebhook(body: unknown): Promise<{ payment?: string; status?: string; ignored?: string; card?: string }> {
  const b = (body ?? {}) as { id?: unknown; transactionId?: unknown; purpose?: unknown };
  // card binding (token checkout): cannot be re-read from Oen, accepted only for a pending binding of ours
  if (b.purpose === "token") {
    const { applyTokenNotice } = await import("./crowd/cards");
    return applyTokenNotice(b as Parameters<typeof applyTokenNotice>[0]);
  }
  const id = typeof b.id === "string" ? b.id : typeof b.transactionId === "string" ? b.transactionId : "";
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(id)) return { ignored: "no transaction id" };
  const pay = await db.payment.findUnique({ where: { oenId: id } });
  if (!pay) return { ignored: "unknown transaction" };
  let p = await syncPayment(pay.id);
  // right after payment Oen may still report the old state
  for (let i = 0; i < 2 && p.status === "PENDING" && ["initiated", "charging"].includes(p.providerStatus ?? ""); i++) {
    await new Promise((r) => setTimeout(r, Number(process.env.OEN_RECHECK_MS ?? 3000)));
    p = await syncPayment(pay.id);
  }
  return { payment: p.id, status: p.status };
}

/**
 * Settle card charges whose outcome was unknown (timeouts, 5xx):
 *  - any charged/claimed transaction for the order → paid
 *  - still being processed → wait up to 3 days
 *  - otherwise, 15 minutes after the attempt → EXPIRED (nothing was charged)
 */
export async function reconcilePayments(now = new Date()) {
  // card pledge charges have no checkout; src/lib/crowd/lifecycle.ts resolves their unknown outcomes
  const pending = await db.payment.findMany({ where: { status: "PENDING", purpose: { not: "CROWD_PLEDGE" }, provider: { in: ["OEN", "MOCK"] }, createdAt: { lt: new Date(now.getTime() - 60_000) } }, take: 100, orderBy: { createdAt: "asc" } });
  let settled = 0;
  for (const pay of pending) {
    const abandoned = (pay.checkoutExpiresAt ?? pay.createdAt).getTime() + 15 * 60_000 < now.getTime();
    if (pay.provider === "MOCK") {
      if (abandoned) await db.payment.updateMany({ where: { id: pay.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      continue;
    }
    try {
      const txs = (await orderTransactions(pay.id, pay.sandbox)).filter((t) => t.orderId === pay.id);
      const paid = txs.find((t) => PAID.has(t.status) || REFUNDED.has(t.status));
      if (paid) {
        await applyTransaction(pay, paid);
        settled++;
        continue;
      }
      const waiting = txs.some((t) => t.status === "charging" || t.status === "authorized");
      if (waiting && now.getTime() - pay.createdAt.getTime() < 3 * 86400_000) continue;
      if (abandoned || waiting) await db.payment.updateMany({ where: { id: pay.id, status: "PENDING" }, data: { status: "EXPIRED", providerStatus: txs[0]?.status ?? pay.providerStatus } });
    } catch (e) {
      console.warn("reconcile", pay.id, (e as Error).message);
    }
  }
  return { checked: pending.length, settled };
}

// ───────────── refunds ─────────────

/** Most that may be refunded: the whole amount; a pledge collected for a funded task never more than its unspent budget */
export async function refundable(pay: Payment): Promise<number> {
  if (pay.status !== "CONFIRMED" || pay.refundedTwd > 0 || !pay.amountTwd) return 0;
  if (!pay.taskId) return pay.amountTwd;
  // proposal fees are non-refundable (an admin can still refund a platform error in the Oen CRM)
  if (pay.purpose === "CROWD_PROPOSAL") return 0;
  const t = await db.task.findUnique({ where: { id: pay.taskId } });
  if (!t) return pay.amountTwd;
  // a pledge charged before funding (campaign still charging) can be refunded whole
  if (pay.purpose === "CROWD_PLEDGE" && !t.fundedAt) return pay.amountTwd;
  const unspent = Math.floor(Number(t.budget) - Math.ceil(Number(t.charged)));
  return Math.max(0, Math.min(pay.amountTwd, unspent));
}

export async function refundPayment(actorId: string, paymentId: string, opts: { amount?: number; reason?: string }) {
  const pay = await db.payment.findUnique({ where: { id: paymentId } });
  if (!pay) throw new HttpError(404, "payment not found");
  if (pay.provider === "TWDC") throw new HttpError(400, "TWDC payments cannot be refunded here");
  const max = await refundable(pay);
  if (max <= 0) throw new HttpError(400, pay.refundedTwd > 0 ? "this payment was already refunded (Oen allows one refund per transaction)" : "nothing left to refund");
  const amount = opts.amount ?? max;
  if (!Number.isInteger(amount) || amount < 1 || amount > max) throw new HttpError(400, `refund must be a whole amount between 1 and ${max} TWD`);
  // claim the refund first so two admins cannot both send one
  const claim = await db.payment.updateMany({ where: { id: pay.id, refundedTwd: 0, refundedAt: null, status: "CONFIRMED" }, data: { refundedAt: new Date(), refundReason: opts.reason ?? null } });
  if (claim.count !== 1) throw new HttpError(409, "a refund is already in progress");
  if (pay.provider === "OEN") {
    if (!pay.transactionHid) throw new HttpError(400, "missing Oen transaction number");
    const plan = pay.planId ? await db.plan.findUnique({ where: { id: pay.planId } }) : null;
    try {
      await refundTransaction(pay.transactionHid, { amount, reason: opts.reason, product: product({ purpose: pay.purpose, planCode: plan?.code, planName: plan?.name, days: plan?.days }, amount) }, pay.sandbox);
    } catch (e) {
      await db.payment.update({ where: { id: pay.id }, data: { refundedAt: null } });
      throw new HttpError(502, `refund failed: ${(e as Error).message}`);
    }
  }
  return recordRefund(await db.payment.findUniqueOrThrow({ where: { id: pay.id } }), amount, opts.reason ?? null, actorId);
}

/** Book a refund that Oen has accepted: return the pledge or cancel the subscription period */
async function recordRefund(pay: Payment, amount: number, reason: string | null, actorId: string | null) {
  const full = amount >= (pay.amountTwd ?? 0);
  const done = await db.payment.updateMany({
    where: { id: pay.id, refundedTwd: 0 },
    data: { refundedTwd: amount, refundedAt: new Date(), refundReason: reason, ...(full ? { status: "REFUNDED" } : {}) },
  });
  if (done.count !== 1) return db.payment.findUniqueOrThrow({ where: { id: pay.id } });
  if (pay.purpose === "SUBSCRIPTION") await cancelPeriod(pay.id);
  else if (pay.purpose === "CROWD_PLEDGE" && pay.taskId) {
    if (full) await db.pledge.updateMany({ where: { paymentId: pay.id }, data: { status: "REFUNDED" } });
    const t = await db.task.findUnique({ where: { id: pay.taskId } });
    if (t?.fundedAt) await db.task.update({ where: { id: pay.taskId }, data: { budget: { decrement: amount } } });
    await db.taskEvent.create({ data: { taskId: pay.taskId, type: "refund", message: `Refunded ${amount} TWD of a pledge`, data: { payment: pay.id } } });
  }
  await audit(actorId, "payment.refund", { type: "payment", id: pay.id }, { amount, reason, full });
  await notify(pay.userId, { type: "payment.refunded", title: `已退款 Refunded ${amount} TWD`, body: reason ?? "", link: pay.taskId ? `/tasks/${pay.taskId}` : "/account#subscription" }).catch(() => undefined);
  return db.payment.findUniqueOrThrow({ where: { id: pay.id } });
}
