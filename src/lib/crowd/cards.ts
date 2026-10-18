import { randomBytes } from "node:crypto";
import { cardBrand, isCardBrand, type CardBrand } from "../card-brand";
import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { createCardBinding } from "../oen";
import { mockAllowed, simulatedCard, simulatedPayments } from "../payment-mode";
import { open, seal } from "../settings/box";

/**
 * Saved cards (Oen token checkout).
 *
 *  1. startBinding: a pending SavedCard keyed by Oen's checkout-token id; the browser opens Oen's binding page
 *     (3-D Secure). Nothing is charged.
 *  2. Oen POSTs a notification with purpose "token". It is unsigned and the token cannot be looked up later, so it
 *     is accepted only for a pending binding we created (the 27-character id is known to Oen, us and the buyer's
 *     browser) and only once. A forged token would simply fail when charged.
 *  3. The token is sealed with the settings key (it works like a password). Every payment on the site charges a
 *     saved card: proposal fees and subscriptions right away, crowdfunding pledges when the goal is reached.
 * Cards bound in test mode (sandbox, Oen testing environment) are only offered while the site is in test mode, and
 * the other way round.
 */

export async function startBinding(userId: string, opts: { returnTo: string; email?: string }) {
  const back = `${config.origin}${opts.returnTo.startsWith("/") ? opts.returnTo : "/account"}`;
  const sandbox = config.testMode;
  // development mock, or test mode without Oen test credentials: SinoBee's own test binding page
  if (simulatedPayments()) {
    const bindingId = `mock_${randomBytes(12).toString("hex")}`;
    const card = await db.savedCard.create({ data: { userId, bindingId, sandbox } });
    return { id: card.id, url: `${config.origin}/pay/mock-card/${card.id}?back=${encodeURIComponent(opts.returnTo)}` };
  }
  const b = await createCardBinding({ customId: userId, payerEmail: opts.email, successUrl: back, failureUrl: back, note: "SinoBee.ai" }, sandbox);
  const card = await db.savedCard.create({ data: { userId, bindingId: b.id, sandbox } });
  return { id: card.id, url: b.url };
}

type TokenNotice = { purpose?: unknown; id?: unknown; success?: unknown; token?: unknown; paymentInfo?: unknown; customId?: unknown; message?: unknown; cardType?: unknown; cardBrand?: unknown; brand?: unknown };

/** Apply a token notification (from the webhook, or the mock binding page). Returns what happened. */
export async function applyTokenNotice(body: TokenNotice): Promise<{ card?: string; status?: string; ignored?: string }> {
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[A-Za-z0-9_-]{10,60}$/.test(id)) return { ignored: "no binding id" };
  const card = await db.savedCard.findUnique({ where: { bindingId: id } });
  if (!card) return { ignored: "unknown binding" };
  if (card.status !== "pending") return { card: card.id, status: card.status, ignored: "already applied" };
  if (typeof body.customId === "string" && body.customId && body.customId !== card.userId) return { ignored: "customId mismatch" };
  const ok = body.success === true && typeof body.token === "string" && body.token.length >= 8;
  const last4 = typeof body.paymentInfo === "string" ? body.paymentInfo.replace(/\D/g, "").slice(-4) || null : null;
  const brand = cardBrand(body.cardBrand, body.cardType, body.brand, body.paymentInfo);
  const r = await db.savedCard.updateMany({
    where: { id: card.id, status: "pending" },
    data: ok
      ? { status: "active", tokenSealed: seal(body.token as string), last4, brand, activatedAt: new Date(), error: null }
      : { status: "failed", error: typeof body.message === "string" ? body.message.slice(0, 200) : "binding failed" },
  });
  if (r.count === 1 && ok) await retryFailedPledges(card.userId);
  return { card: card.id, status: ok ? "active" : "failed" };
}

/** A new card was saved: failed pledges of that backer still inside their grace period are retried with it */
async function retryFailedPledges(userId: string) {
  const card = await latestCard(userId);
  if (!card) return;
  await db.pledge.updateMany({ where: { userId, source: "CARD", status: "FAILED", task: { status: { in: ["CHARGING", "QUEUED", "RUNNING", "NEEDS_FUNDING"] } } }, data: { cardId: card.id } });
  const { retryBacker } = await import("./lifecycle");
  await retryBacker(userId).catch((e) => console.warn("crowd retry", (e as Error).message));
}

/** What the card pickers show of a saved card */
export const cardOpt = (c: { id: string; last4: string | null; brand?: string | null }) => ({ id: c.id, last4: c.last4, brand: isCardBrand(c.brand) ? c.brand : (null as CardBrand | null) });

export async function activeCards(userId: string) {
  return db.savedCard.findMany({ where: { userId, status: "active", sandbox: config.testMode }, orderBy: { activatedAt: "desc" }, select: { id: true, last4: true, brand: true, activatedAt: true } });
}

export async function latestCard(userId: string) {
  return db.savedCard.findFirst({ where: { userId, status: "active", sandbox: config.testMode }, orderBy: { activatedAt: "desc" } });
}

/** A card the user picked at checkout: theirs, active, and from the current mode */
export async function usableCard(userId: string, cardId: string) {
  const card = await db.savedCard.findUnique({ where: { id: cardId } });
  if (!card || card.userId !== userId || card.status !== "active") throw new HttpError(400, "choose a saved card (or bind one first)");
  if (card.sandbox !== config.testMode) throw new HttpError(400, card.sandbox ? "this test card cannot be used now that test mode is off" : "real cards cannot be used in test mode; bind a test card");
  return card;
}

/** A binding the user just started and Oen has not confirmed yet (the checkout page waits for it) */
export async function pendingBinding(userId: string) {
  return db.savedCard.findFirst({ where: { userId, status: "pending", sandbox: config.testMode, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } }, select: { id: true } });
}

/** The card's token (server side only) */
export function cardToken(card: { tokenSealed: string | null }): string {
  if (!card.tokenSealed) throw new HttpError(400, "card is not ready");
  return open(card.tokenSealed);
}

/** Forget a card. Oen has no delete API, so removing it here (and the token with it) is what deletes it. */
export async function removeCard(userId: string, cardId: string) {
  const card = await db.savedCard.findUnique({ where: { id: cardId } });
  if (!card || card.userId !== userId) throw new HttpError(404, "card not found");
  const waiting = await db.pledge.count({ where: { cardId, status: { in: ["ACTIVE", "FAILED"] } } });
  if (waiting) throw new HttpError(400, "this card backs pledges that are not charged yet; add another card first or cancel those pledges");
  await db.savedCard.update({ where: { id: cardId }, data: { status: "removed", tokenSealed: null, removedAt: new Date() } });
}

/** Simulated binding (development mock or the built-in test gateway): pretend the buyer finished 3-D Secure */
export async function completeMockBinding(userId: string, cardId: string, ok: boolean, behaviour: "ok" | "decline" = "ok") {
  const card = await db.savedCard.findUnique({ where: { id: cardId } });
  if (!card || card.userId !== userId || !simulatedCard(card)) throw new HttpError(404, "card not found");
  // production builds: only test-mode cards may be simulated
  if (!mockAllowed() && !card.sandbox) throw new HttpError(404, "not found");
  return applyTokenNotice({ purpose: "token", id: card.bindingId, success: ok, token: ok ? `mock_${behaviour}_${randomBytes(8).toString("hex")}` : undefined, paymentInfo: ok ? "424242******4242" : undefined, customId: userId });
}

/** What a checkout form needs: the cards of the current mode, whether a binding is waiting, test mode */
export async function checkoutCards(userId: string) {
  const [cards, pending] = await Promise.all([activeCards(userId), pendingBinding(userId)]);
  return { cards: cards.map(cardOpt), pendingCard: !!pending, test: config.testMode };
}
