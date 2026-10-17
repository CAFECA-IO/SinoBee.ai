import { config } from "./config";
import { HttpError } from "./errors";

/**
 * Oen Payment API client (https://developer.oen.tw). Server-side only: the token never reaches the browser.
 *
 *  GET  /transactions/:id              → Transaction (source of truth; webhooks are unsigned and only a hint)
 *  GET  /order/:orderId/transactions   → every transaction created for one order (reconciliation)
 *  POST /refunds/:transactionHid       → one successful API refund per transaction
 *  POST /checkout-token                → card binding page (3-D Secure); the token arrives only in the webhook
 *  POST /token/transactions            → charge a saved card (no 3-D Secure, no notification: the response decides)
 *
 * SinoBee charges only saved cards: a card is bound once (3-D Secure) and each checkout charges its token.
 * Every response is { code: "S0000" | error code, data, message }.
 */

export type OenProduct = { productionCode: string; description: string; quantity: number; unit: string; unitPrice: number };

export type OenInvoice =
  | { invoiceType: "cloud"; carrierType: "3J0002" | "CQ0001" | ""; carrierId?: string; email?: string }
  | { invoiceType: "company"; buyerIdentifier: string; buyerName?: string; email?: string };

export type OenTransaction = {
  id: string; // P… transaction number
  transactionId: string; // 27-char internal id
  action?: string;
  amount: number;
  status: "initiated" | "charging" | "authorized" | "charged" | "claimed" | "failed" | "cancelled" | "refunding" | "refunded" | "refundedPostPayout" | string;
  orderId?: string;
  customId?: string;
  paymentMethod?: string;
  createdAt: string;
  paidAt?: string;
  refundAmount?: number;
  refundedAt?: string;
  reason?: string;
  success?: boolean;
};

export const PAID = new Set(["charged", "claimed"]);
export const REFUNDED = new Set(["refunded", "refundedPostPayout", "refunding"]);
export const DEAD = new Set(["failed", "cancelled"]);

export class OenError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(`Oen ${code}: ${message}`);
  }
}

export function oenConfigured(sandbox = config.testMode) {
  const c = config.oen.for(sandbox);
  return !!(c.token && c.merchantId);
}

/**
 * One Oen API call. `sandbox` picks the credentials: records made in test mode always talk to the testing
 * environment (with the test credentials when set), whatever mode the site is in now.
 */
async function call<T>(method: "GET" | "POST", path: string, body: object | undefined, sandbox: boolean, extraHeaders: Record<string, string> = {}): Promise<T> {
  if (!oenConfigured(sandbox)) throw new HttpError(503, "Oen payments are not configured (OEN_MERCHANT_ID / OEN_API_TOKEN)");
  const c = config.oen.for(sandbox);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${c.apiBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${c.token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
      body: body ? JSON.stringify({ merchantId: c.merchantId, ...body }) : undefined,
      signal: ctrl.signal,
    });
    const text = await r.text();
    let j: { code?: string; data?: T; message?: string } = {};
    try {
      j = JSON.parse(text);
    } catch {
      /* 403 / 404 / 504 can be plain text */
    }
    if (r.status === 403 && !j.code) throw new OenError("IP", 403, "server IP is not on Oen's allowlist (production)");
    if (!r.ok || j.code !== "S0000") throw new OenError(j.code ?? `HTTP${r.status}`, r.status, j.message || text.slice(0, 200));
    return j.data as T;
  } finally {
    clearTimeout(timer);
  }
}

export const getTransaction = (id: string, sandbox: boolean) => call<OenTransaction>("GET", `/transactions/${encodeURIComponent(id)}`, undefined, sandbox);

export const orderTransactions = (orderId: string, sandbox: boolean) => call<OenTransaction[]>("GET", `/order/${encodeURIComponent(orderId)}/transactions`, undefined, sandbox);

export const refundTransaction = (hid: string, p: { amount: number; reason?: string; product: OenProduct }, sandbox: boolean) =>
  call<OenTransaction>("POST", `/refunds/${encodeURIComponent(hid)}`, { amount: p.amount, reason: p.reason, productDetails: [p.product] }, sandbox);

// ───────────── saved cards (token checkout) ─────────────

/** Card binding page. Open `url` in the browser; the token comes in a webhook with purpose "token" and this id. */
export async function createCardBinding(p: { customId: string; payerEmail?: string; successUrl: string; failureUrl: string; note?: string }, sandbox: boolean) {
  const data = await call<{ id: string }>(
    "POST",
    "/checkout-token",
    { successUrl: p.successUrl, failureUrl: p.failureUrl, customId: p.customId, note: p.note, ...(p.payerEmail ? { payerEmail: p.payerEmail } : {}) },
    sandbox,
  );
  return { id: data.id, url: `${config.oen.for(sandbox).checkoutBase}/checkout/subscription/create/${data.id}` };
}

/** Errors after which the card itself is the problem (expired, declined…): ask the backer for another card */
export const CARD_ERRORS = new Set(["T0001", "T0002", "T0003", "T0004", "T0005", "T0010", "A0001", "A0002"]);
/** The outcome is unknown: never retry blindly, look the order up first */
export const UNKNOWN_ERRORS = new Set(["C026", "I0002", "I0003"]);

/** Charge a saved card. Resolves with the P… transaction number; rejects with OenError (code T000x = declined). */
export async function chargeToken(p: {
  token: string;
  amount: number;
  orderId: string;
  product: OenProduct;
  idempotencyKey: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  invoiceInfo?: OenInvoice;
  sandbox: boolean;
}) {
  return call<{ id: string; authCode?: string }>(
    "POST",
    "/token/transactions",
    {
      amount: p.amount,
      currency: "TWD",
      token: p.token,
      orderId: p.orderId,
      productDetails: [p.product],
      userId: p.userId,
      userName: p.userName,
      userEmail: p.userEmail,
      invoiceInfo: p.invoiceInfo,
    },
    p.sandbox,
    { "Idempotency-Key": p.idempotencyKey },
  );
}
