import { createPublicClient, decodeEventLog, http, parseAbiItem, type Hex } from "viem";
import { db } from "./db";
import { config } from "./config";
import { cafeca } from "./cafeca";
import { HttpError } from "./errors";
import { fromBase, toBase } from "./money";
import { notify } from "./notify";
import { addDays } from "./retention";
import type { PaymentPurpose } from "@/generated/prisma/client";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export async function chainInfo() {
  const c = await cafeca.config();
  const token = (process.env.TWDC_ADDRESS || c.contracts?.twdc || "").toLowerCase();
  if (!token) throw new HttpError(500, "TWDC token address unknown");
  return { chainId: c.chain.id, rpc: config.cafecaRpcUrl ?? c.chain.rpc, token };
}

/** Create a payment intent. The browser then pays through the CAFECA signing channel (sendCalls). */
export async function createPayment(p: { userId: string; purpose: PaymentPurpose; amount: string; taskId?: string; meta?: object }) {
  if (config.payments.mode === "chain" && !/^0x[0-9a-f]{40}$/.test(config.payments.treasury)) throw new HttpError(500, "TREASURY_ADDRESS not configured");
  const base = toBase(p.amount);
  if (base <= 0n) throw new HttpError(400, "amount must be positive");
  const { chainId, token } = config.payments.mode === "mock" ? { chainId: 0, token: "0x0000000000000000000000000000000000000000" } : await chainInfo();
  const pay = await db.payment.create({
    data: {
      userId: p.userId,
      purpose: p.purpose,
      taskId: p.taskId ?? null,
      amount: fromBase(base),
      amountBase: base.toString(),
      token,
      recipient: config.payments.treasury || "0x0000000000000000000000000000000000000000",
      meta: p.meta ?? undefined,
    },
  });
  return { id: pay.id, amount: pay.amount.toString(), amountBase: pay.amountBase, token, recipient: pay.recipient, chainId, mode: config.payments.mode };
}

/** Verify the on-chain TWDC transfer (from the user's account to the treasury) and apply the payment. */
export async function confirmPayment(userId: string, paymentId: string, txHash?: string) {
  const pay = await db.payment.findUnique({ where: { id: paymentId }, include: { user: true } });
  if (!pay || pay.userId !== userId) throw new HttpError(404, "payment not found");
  if (pay.status === "CONFIRMED") return pay;

  if (config.payments.mode === "chain") {
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new HttpError(400, "txHash required");
    const dup = await db.payment.findUnique({ where: { txHash: txHash.toLowerCase() } });
    if (dup && dup.id !== pay.id) throw new HttpError(409, "transaction already used for another payment");
    const { rpc } = await chainInfo();
    const pc = createPublicClient({ transport: http(rpc) });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 60_000 }).catch(() => null);
    if (!receipt) throw new HttpError(400, "transaction not found yet, retry shortly");
    if (receipt.status !== "success") {
      await db.payment.update({ where: { id: pay.id }, data: { status: "FAILED", txHash: txHash.toLowerCase(), error: "transaction reverted" } });
      throw new HttpError(400, "transaction reverted");
    }
    let paid = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== pay.token) continue;
      try {
        const ev = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
        if (ev.args.from.toLowerCase() === pay.user.account && ev.args.to.toLowerCase() === pay.recipient) paid += ev.args.value;
      } catch {
        /* not a Transfer */
      }
    }
    if (paid < BigInt(pay.amountBase)) throw new HttpError(400, `transfer amount ${fromBase(paid)} is less than ${pay.amount}`);
  }

  const done = await db.payment.updateMany({
    where: { id: pay.id, status: "PENDING" },
    data: { status: "CONFIRMED", confirmedAt: new Date(), txHash: txHash ? txHash.toLowerCase() : null },
  });
  if (done.count === 1) await applyPayment(pay.id);
  return db.payment.findUniqueOrThrow({ where: { id: pay.id } });
}

async function applyPayment(paymentId: string) {
  const pay = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (pay.purpose === "SUBSCRIPTION") {
    const last = await db.subscription.findFirst({ where: { userId: pay.userId }, orderBy: { endsAt: "desc" } });
    const start = last && last.endsAt > new Date() ? last.endsAt : new Date();
    const sub = await db.subscription.create({
      data: { userId: pay.userId, plan: "pro", startsAt: start, endsAt: addDays(start, config.subscription.days), paymentId: pay.id },
    });
    // subscribers keep their container while subscribed; extend result downloads too
    await db.userContainer.updateMany({ where: { userId: pay.userId }, data: { expiresAt: sub.endsAt } });
    await notify(pay.userId, { type: "subscription.active", title: "Subscription active", body: `Valid until ${sub.endsAt.toISOString().slice(0, 10)}`, link: "/account" });
    return;
  }
  if (!pay.taskId) return;
  const task = await db.task.findUniqueOrThrow({ where: { id: pay.taskId } });
  const wasWaiting = task.status === "AWAITING_PAYMENT" || task.status === "NEEDS_FUNDING";
  await db.task.update({
    where: { id: task.id },
    data: {
      budget: { increment: pay.amount },
      ...(wasWaiting ? { status: "QUEUED", fundingRequestedAt: null } : {}),
    },
  });
  await db.taskEvent.create({
    data: { taskId: task.id, type: "payment", message: `${pay.purpose === "TASK_TOPUP" ? "Top-up" : "Budget"} ${pay.amount} TWD confirmed`, data: { txHash: pay.txHash } },
  });
}
