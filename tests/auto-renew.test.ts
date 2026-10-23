import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "./helpers/testdb";
import { StubOen } from "./helpers/stub-oen";

useTestDb();
const oen = new StubOen();
process.env.PAYMENT_MODE = "oen";
process.env.OEN_MERCHANT_ID = oen.merchant;
process.env.OEN_API_TOKEN = oen.token;
process.env.OEN_RECHECK_MS = "10";

let db: typeof import("../src/lib/db").db;
let pay: typeof import("../src/lib/payments");
let subs: typeof import("../src/lib/subscriptions");
let plans: typeof import("../src/lib/plans");
let cards: typeof import("../src/lib/crowd/cards");
let renew: typeof import("../src/lib/auto-renew");
type U = Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;
let low: { id: string; code: string; feeTwd: number; days: number };
const buyer = { name: "王小明", email: "ming@example.com" };
const DAY = 86400_000;

before(async () => {
  await oen.start();
  process.env.OEN_API_BASE = oen.url;
  ({ db } = await import("../src/lib/db"));
  pay = await import("../src/lib/payments");
  subs = await import("../src/lib/subscriptions");
  plans = await import("../src/lib/plans");
  cards = await import("../src/lib/crowd/cards");
  renew = await import("../src/lib/auto-renew");
  low = (await plans.listPlans()).find((p) => p.code === "low")!;
});
after(() => oen.stop());

let n = 0;
async function user() {
  n++;
  return db.user.create({ data: { account: "0x" + String(n).padStart(40, "0"), handle: `u${n}` } });
}
async function bind(userId: string, behaviour = "ok") {
  const b = await cards.startBinding(userId, { returnTo: "/account" });
  const card = await db.savedCard.findUniqueOrThrow({ where: { id: b.id } });
  await pay.handleWebhook(oen.bindCard(card.bindingId, true, behaviour));
  return card.id;
}
/** a paid period that ends `endsIn` ms from now */
async function period(u: U, endsIn: number) {
  const p = await db.payment.create({ data: { userId: u.id, purpose: "SUBSCRIPTION", provider: "MOCK", amount: low.feeTwd, amountTwd: low.feeTwd, amountBase: String(low.feeTwd), token: "TWD", recipient: "mock", status: "CONFIRMED", planId: low.id } });
  const endsAt = new Date(Date.now() + endsIn);
  return db.subscription.create({ data: { userId: u.id, plan: low.code, planId: low.id, startsAt: new Date(endsAt.getTime() - 30 * DAY), endsAt, paymentId: p.id } });
}
const notes = (u: U, type: string) => db.notification.count({ where: { userId: u.id, type } });

test("off by default: reminders 7 days and 1 day before the end, once each", async () => {
  const u = await user();
  await period(u, 6 * DAY);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).autoRenew, false);
  const now = new Date();
  await renew.renewTick(now);
  await renew.renewTick(now);
  assert.equal(await notes(u, "subscription.ending"), 1);
  await renew.renewTick(new Date(now.getTime() + 5.5 * DAY));
  assert.equal(await notes(u, "subscription.ending"), 2);
  assert.equal(await db.payment.count({ where: { userId: u.id, status: { not: "CONFIRMED" } } }), 0, "nothing charged");
});

test("on: a notice first, then the charge 3 days before the end adds the next period with no gap", async () => {
  const u = await user();
  const card = await bind(u.id);
  await assert.rejects(renew.setAutoRenew(u.id, true, { cardId: card }), /buyer/, "the e-invoice needs a buyer");
  await assert.rejects(renew.setAutoRenew(u.id, true), /choose a saved card/);
  const st = await renew.setAutoRenew(u.id, true, { cardId: card, buyer });
  assert.equal(st.on, true);
  const sub = await period(u, 3.5 * DAY);
  const now = new Date();
  await renew.renewTick(now);
  assert.equal(await notes(u, "subscription.renew.notice"), 1, "told before any charge");
  assert.equal(await db.payment.count({ where: { userId: u.id, purpose: "SUBSCRIPTION", provider: "OEN" } }), 0);
  await renew.renewTick(new Date(now.getTime() + 0.6 * DAY));
  const charged = await db.payment.findFirstOrThrow({ where: { userId: u.id, purpose: "SUBSCRIPTION", provider: "OEN" } });
  assert.equal(charged.status, "CONFIRMED");
  assert.equal(charged.amountTwd, low.feeTwd);
  const next = await db.subscription.findUniqueOrThrow({ where: { paymentId: charged.id } });
  assert.equal(next.startsAt.getTime(), sub.endsAt.getTime(), "starts exactly when the old period ends");
  await renew.renewTick(new Date(now.getTime() + 1.6 * DAY));
  assert.equal(await db.payment.count({ where: { userId: u.id, purpose: "SUBSCRIPTION", provider: "OEN" } }), 1, "charged once");
  await renew.setAutoRenew(u.id, false);
  assert.equal((await renew.autoRenewState(u.id)).on, false);
});

test("a declined card: every failure is told with the next try; a new card on the last try renews", async () => {
  const u = await user();
  const bad = await bind(u.id, "T0005");
  await renew.setAutoRenew(u.id, true, { cardId: bad, buyer });
  const sub = await period(u, 3.9 * DAY);
  const now = new Date();
  await renew.renewTick(now); // notice
  await renew.renewTick(new Date(now.getTime() + 1 * DAY)); // 2.9 days left: try 1
  await renew.renewTick(new Date(now.getTime() + 1.1 * DAY)); // same window: no new try
  assert.equal(await notes(u, "subscription.renew.failed"), 1);
  await renew.renewTick(new Date(now.getTime() + 2 * DAY)); // 1.9 days left: try 2
  assert.equal(await notes(u, "subscription.renew.failed"), 2);
  const good = await bind(u.id);
  await renew.setAutoRenew(u.id, true, { cardId: good });
  await renew.renewTick(new Date(now.getTime() + 3 * DAY)); // 0.9 days left: try 3
  const ok = await db.payment.findFirstOrThrow({ where: { userId: u.id, status: "CONFIRMED", provider: "OEN" } });
  assert.equal(ok.cardId, good);
  assert.equal((await db.subscription.findUniqueOrThrow({ where: { paymentId: ok.id } })).startsAt.getTime(), sub.endsAt.getTime());
  assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).renewAttempts, 3);
});

test("a renewal confirmed after the period ended still joins it without a gap", async () => {
  const u = await user();
  const old = await period(u, -3600_000);
  const p = await db.payment.create({ data: { userId: u.id, purpose: "SUBSCRIPTION", provider: "MOCK", amount: low.feeTwd, amountTwd: low.feeTwd, amountBase: String(low.feeTwd), token: "TWD", recipient: "mock", status: "CONFIRMED", planId: low.id } });
  const joined = await subs.addPeriod(u.id, p.id, { id: low.id, code: low.code, days: 30 }, { after: old.endsAt });
  assert.equal(joined.startsAt.getTime(), old.endsAt.getTime());
  const p2 = await db.payment.create({ data: { userId: u.id, purpose: "SUBSCRIPTION", provider: "MOCK", amount: 1, amountTwd: 1, amountBase: "1", token: "TWD", recipient: "mock", status: "CONFIRMED", planId: low.id } });
  const u2 = await user();
  await period(u2, -3600_000);
  const fresh = await subs.addPeriod(u2.id, p2.id, { id: low.id, code: low.code, days: 30 }, { after: new Date(0) });
  assert.ok(fresh.startsAt.getTime() > Date.now() - 60_000, "a manual purchase after a gap starts now");
});
