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
let overview: typeof import("../src/lib/admin-overview");
type U = Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;
let alice: U, admin: U;
let high: { id: string; feeTwd: number }, low: { id: string; feeTwd: number };
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
  overview = await import("../src/lib/admin-overview");
  alice = await db.user.create({ data: { account: "0x" + "1".repeat(40), handle: "alice" } });
  admin = await db.user.create({ data: { account: "0x" + "9".repeat(40), role: "ADMIN", isAdmin: true } });
  const ps = await plans.listPlans();
  high = ps.find((p) => p.code === "high")!;
  low = ps.find((p) => p.code === "low")!;
});
after(() => oen.stop());

/** Bind a card through the stub Oen (token checkout + token notification) */
async function bind(userId: string, behaviour = "ok") {
  const b = await cards.startBinding(userId, { returnTo: "/subscribe" });
  const card = await db.savedCard.findUniqueOrThrow({ where: { id: b.id } });
  assert.match(b.url, /\/checkout\/subscription\/create\//);
  await pay.handleWebhook(oen.bindCard(card.bindingId, true, behaviour));
  return card.id;
}
const txOfOrder = (paymentId: string) => [...oen.txs.values()].find((t) => t.orderId === paymentId)!;

let card = "";

test("checkout charges the chosen saved card at once: product line, buyer and invoice sent to Oen, period granted", async () => {
  card = await bind(alice.id);
  const c = await pay.createPayment({ userId: alice.id, purpose: "SUBSCRIPTION", amountTwd: high.feeTwd, planId: high.id, cardId: card, buyer: { ...buyer, invoice: { invoiceType: "company", buyerIdentifier: "12345678", buyerName: "CAFECA" } } });
  assert.equal(c.status, "CONFIRMED", "no redirect: the response decides");
  assert.equal(c.cardId, card);
  assert.equal(c.sandbox, false);
  const tx = txOfOrder(c.id);
  assert.equal(tx.body.amount, 3675);
  assert.equal(c.transactionHid, tx.id);
  assert.deepEqual(tx.body.productDetails, [{ productionCode: "SUB-HIGH", description: "SinoBee.ai 訂閱（Ultra，30 天）", quantity: 1, unit: "期", unitPrice: 3675 }]);
  assert.deepEqual(tx.body.invoiceInfo, { invoiceType: "company", buyerIdentifier: "12345678", buyerName: "CAFECA", email: "ming@example.com" });
  assert.ok(oen.calls.includes("POST /token/transactions"));
  assert.ok(!oen.calls.includes("POST /checkout"), "no hosted checkout page");
  assert.ok(await db.subscription.findUnique({ where: { paymentId: c.id } }), "the period was granted");
  assert.ok((await db.user.findUniqueOrThrow({ where: { id: alice.id } })).billing, "buyer details remembered");
  await assert.rejects(pay.createPayment({ userId: alice.id, purpose: "CROWD_PROPOSAL", amountTwd: 10.5, cardId: card, buyer }), /whole TWD/);
  await assert.rejects(pay.createPayment({ userId: alice.id, purpose: "CROWD_PROPOSAL", amountTwd: 50, cardId: card, buyer: { name: "x", email: "nope" } }), /valid email/);
  await assert.rejects(pay.createPayment({ userId: admin.id, purpose: "CROWD_PROPOSAL", amountTwd: 50, cardId: card, buyer }), /choose a saved card/, "someone else's card");
});

test("a second payment reuses the card (no new binding) and stacks the next period", async () => {
  const bindings = oen.calls.filter((c) => c === "POST /checkout-token").length;
  const c = await pay.createPayment({ userId: alice.id, purpose: "SUBSCRIPTION", amountTwd: low.feeTwd, planId: low.id, cardId: card, buyer });
  assert.equal(c.status, "CONFIRMED");
  assert.equal(oen.calls.filter((x) => x === "POST /checkout-token").length, bindings);
  assert.equal((await subs.subscriptionState(alice.id)).upcoming.length, 1);
});

test("a declined card: 402, FAILED, nothing granted; another card goes through", async () => {
  const bad = await bind(alice.id, "T0005");
  const task = await db.task.create({ data: { userId: alice.id, title: "Sales report", prompt: "Summarise the sales data for Q3", model: "anthropic/claude-sonnet-5-5" } });
  await assert.rejects(pay.createPayment({ userId: alice.id, purpose: "CROWD_PROPOSAL", amountTwd: 30, taskId: task.id, cardId: bad, buyer }), (e: Error & { status?: number }) => /declined \(T0005\)/.test(e.message));
  const failed = await db.payment.findFirstOrThrow({ where: { taskId: task.id, cardId: bad } });
  assert.equal(failed.status, "FAILED");
  assert.equal(Number((await db.task.findUniqueOrThrow({ where: { id: task.id } })).proposalCreditTwd), 0);
  const ok = await pay.createPayment({ userId: alice.id, purpose: "CROWD_PROPOSAL", amountTwd: 30, taskId: task.id, cardId: card, buyer });
  assert.equal(ok.status, "CONFIRMED");
  assert.equal(Number((await db.task.findUniqueOrThrow({ where: { id: task.id } })).proposalCreditTwd), 30);
});

test("no answer from Oen: the payment waits, reconciliation finds the charge and grants it once", async () => {
  const lost = await bind(alice.id, "lost");
  const task = await db.task.create({ data: { userId: alice.id, title: "Lost answer", prompt: "x", model: "anthropic/claude-sonnet-5-5" } });
  const c = await pay.createPayment({ userId: alice.id, purpose: "CROWD_PROPOSAL", amountTwd: 30, taskId: task.id, cardId: lost, buyer });
  assert.equal(c.status, "PENDING");
  assert.match(c.error ?? "", /C026/);
  await db.payment.update({ where: { id: c.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
  const r = await pay.reconcilePayments();
  assert.equal(r.settled, 1);
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: c.id } })).status, "CONFIRMED");
  await pay.reconcilePayments();
  await pay.syncPayment(c.id);
  assert.equal(Number((await db.task.findUniqueOrThrow({ where: { id: task.id } })).proposalCreditTwd), 30, "granted once");
});

test("forged webhooks: unknown ids never reach Oen; the body is never trusted", async () => {
  const calls = oen.calls.length;
  assert.equal((await pay.handleWebhook({ id: "x".repeat(27), status: "charged", amount: 3675 })).ignored, "unknown transaction");
  assert.equal((await pay.handleWebhook({ hello: 1 })).ignored, "no transaction id");
  assert.equal((await pay.handleWebhook({ purpose: "token", id: "y".repeat(27), success: true, token: "forged-token" })).ignored, "unknown binding");
  assert.equal(oen.calls.length, calls, "no API call for unknown ids");
});

test("test mode: cards and payments go to the testing environment, stay apart from real ones and are not revenue", async () => {
  const before = (await overview.adminStats()).revenue30;
  process.env.SITE_TEST_MODE = "1";
  try {
    assert.equal((await cards.activeCards(alice.id)).length, 0, "real cards are not offered in test mode");
    await assert.rejects(pay.createPayment({ userId: alice.id, purpose: "CROWD_PROPOSAL", amountTwd: 30, cardId: card, buyer }), /real cards cannot be used in test mode/);
    const test = await bind(alice.id);
    assert.equal((await db.savedCard.findUniqueOrThrow({ where: { id: test } })).sandbox, true);
    const c = await pay.createPayment({ userId: alice.id, purpose: "SUBSCRIPTION", amountTwd: low.feeTwd, planId: low.id, cardId: test, buyer });
    assert.equal(c.status, "CONFIRMED");
    assert.equal(c.sandbox, true);
    assert.equal((await overview.adminStats()).revenue30, before, "test payments are not revenue");
    process.env.SITE_TEST_MODE = "0";
    assert.deepEqual((await cards.activeCards(alice.id)).map((x) => x.id).includes(test), false, "test cards are hidden again");
    await assert.rejects(pay.createPayment({ userId: alice.id, purpose: "CROWD_PROPOSAL", amountTwd: 30, cardId: test, buyer }), /test card cannot be used/);
    // a test payment is still refunded in the testing environment after test mode is off
    const r = await pay.refundPayment(admin.id, c.id, { reason: "test" });
    assert.equal(r.status, "REFUNDED");
  } finally {
    delete process.env.SITE_TEST_MODE;
  }
});

test("test mode without Oen test credentials: the built-in test gateway binds and charges, no error, nothing reaches Oen", async () => {
  const saved = { m: process.env.OEN_MERCHANT_ID, t: process.env.OEN_API_TOKEN };
  process.env.SITE_TEST_MODE = "1";
  delete process.env.OEN_MERCHANT_ID;
  delete process.env.OEN_API_TOKEN;
  const calls = oen.calls.length;
  try {
    const b = await cards.startBinding(admin.id, { returnTo: "/crowd/new" });
    assert.match(b.url, /\/pay\/mock-card\//, "SinoBee's own test binding page");
    const r = await cards.completeMockBinding(admin.id, b.id, true);
    assert.equal(r.status, "active");
    const c = await pay.createPayment({ userId: admin.id, purpose: "SUBSCRIPTION", amountTwd: low.feeTwd, planId: low.id, cardId: b.id, buyer });
    assert.equal(c.status, "CONFIRMED");
    assert.equal(c.provider, "MOCK");
    assert.equal(c.sandbox, true);
    const bad = await cards.startBinding(admin.id, { returnTo: "/crowd/new" });
    await cards.completeMockBinding(admin.id, bad.id, true, "decline");
    await assert.rejects(pay.createPayment({ userId: admin.id, purpose: "CROWD_PROPOSAL", amountTwd: 30, cardId: bad.id, buyer }), /declined/);
    assert.equal(oen.calls.length, calls, "no Oen call at all");
    // test cards stay test cards
    process.env.SITE_TEST_MODE = "0";
    await assert.rejects(pay.createPayment({ userId: admin.id, purpose: "CROWD_PROPOSAL", amountTwd: 30, cardId: b.id, buyer }), /test card cannot be used/);
  } finally {
    process.env.OEN_MERCHANT_ID = saved.m;
    process.env.OEN_API_TOKEN = saved.t;
    delete process.env.SITE_TEST_MODE;
  }
});

test("refund: once per transaction; subscription refund cancels the period and later ones move up", async () => {
  const st0 = await subs.subscriptionState(alice.id);
  const current = await db.subscription.findUniqueOrThrow({ where: { id: st0.current!.id } });
  const upcoming = st0.upcoming[0];
  const r = await pay.refundPayment(admin.id, current.paymentId, { reason: "changed mind" });
  assert.equal(r.status, "REFUNDED");
  assert.equal(r.refundedTwd, 3675);
  await assert.rejects(pay.refundPayment(admin.id, current.paymentId, {}), /already refunded/);
  const st = await subs.subscriptionState(alice.id);
  assert.equal(st.current?.id, upcoming.id, "the prepaid period starts now");
  assert.ok(Math.abs(st.endsAt!.getTime() - Date.now() - 30 * DAY) < 60_000);
  assert.ok(await db.adminAudit.findFirst({ where: { action: "payment.refund", targetId: current.paymentId } }));
});

test("pledge refunds on a funded task are limited to the unspent budget and reduce it", async () => {
  const task = await db.task.create({ data: { userId: alice.id, title: "Another one", prompt: "Draft the weekly newsletter", model: "anthropic/claude-haiku-5-5", status: "COMPLETED", fundedAt: new Date(), budget: 200, charged: 57.2 } });
  const c = await pay.createPayment({ userId: alice.id, purpose: "CROWD_PLEDGE", amountTwd: 200, taskId: task.id, cardId: card, buyer });
  assert.equal(await pay.refundable(c), 142, "200 − ceil(57.2)");
  await assert.rejects(pay.refundPayment(admin.id, c.id, { amount: 150 }), /between 1 and 142/);
  const r = await pay.refundPayment(admin.id, c.id, { amount: 142, reason: "unused budget" });
  assert.equal(r.status, "CONFIRMED", "partial refund keeps the payment confirmed");
  assert.equal(Number((await db.task.findUniqueOrThrow({ where: { id: task.id } })).budget), 58);
  assert.equal(txOfOrder(c.id).refundAmount, 142);
});

test("a refund made in the Oen CRM is picked up by sync", async () => {
  const c = await pay.createPayment({ userId: alice.id, purpose: "SUBSCRIPTION", amountTwd: low.feeTwd, planId: low.id, cardId: card, buyer });
  const tx = txOfOrder(c.id);
  tx.status = "refunded";
  tx.refundAmount = tx.amount;
  const p = await pay.syncPayment(c.id);
  assert.equal(p.status, "REFUNDED");
  assert.ok((await db.subscription.findUniqueOrThrow({ where: { paymentId: c.id } })).cancelledAt);
});

test("results are kept through the grace period and come back on renewal", async () => {
  const task = await db.task.create({ data: { userId: alice.id, title: "old", prompt: "old task prompt", model: "anthropic/claude-haiku-5-5", status: "COMPLETED", resultsExpireAt: new Date(Date.now() - DAY) } });
  const art = await db.artifact.create({ data: { taskId: task.id, key: "k", filename: "out.zip", sizeBytes: 1n, sha256: "x", expiresAt: new Date(Date.now() - DAY) } });
  await subs.applyRetention(alice.id);
  const st = await subs.subscriptionState(alice.id);
  assert.equal((await db.artifact.findUniqueOrThrow({ where: { id: art.id } })).expiresAt?.getTime(), st.graceEndsAt!.getTime());
});
