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
let tasks: typeof import("../src/lib/tasks/service");
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
  tasks = await import("../src/lib/tasks/service");
  alice = await db.user.create({ data: { account: "0x" + "1".repeat(40), handle: "alice" } });
  admin = await db.user.create({ data: { account: "0x" + "9".repeat(40), role: "ADMIN", isAdmin: true } });
  const ps = await plans.listPlans();
  high = ps.find((p) => p.code === "high")!;
  low = ps.find((p) => p.code === "low")!;
});
after(() => oen.stop());

const txOf = async (paymentId: string) => {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  return oen.txs.get(p.oenId!)!;
};

test("checkout: whole TWD, product lines match the amount, buyer and invoice sent to Oen", async () => {
  const c = await pay.createPayment({ userId: alice.id, purpose: "SUBSCRIPTION", amountTwd: high.feeTwd, planId: high.id, buyer: { ...buyer, invoice: { invoiceType: "company", buyerIdentifier: "12345678", buyerName: "CAFECA" } } });
  assert.match(c.checkoutUrl, new RegExp(`^https://sinobee\\.testing\\.oen\\.tw/checkout/`));
  const tx = await txOf(c.id);
  assert.equal(tx.body.amount, 3675);
  assert.equal(tx.body.orderId, c.id);
  assert.deepEqual(tx.body.productDetails, [{ productionCode: "SUB-HIGH", description: "SinoBee.ai 訂閱（Ultra，30 天）", quantity: 1, unit: "期", unitPrice: 3675 }]);
  assert.deepEqual(tx.body.invoiceInfo, { invoiceType: "company", buyerIdentifier: "12345678", buyerName: "CAFECA", email: "ming@example.com" });
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: alice.id } })).billing && true, true, "buyer details remembered");
  await assert.rejects(pay.createPayment({ userId: alice.id, purpose: "TASK_TOPUP", amountTwd: 10.5, buyer }), /whole TWD/);
  await assert.rejects(pay.createPayment({ userId: alice.id, purpose: "TASK_TOPUP", amountTwd: 50, buyer: { name: "x", email: "nope" } }), /valid email/);
});

test("success: webhook → GET /transactions → one period; duplicate and late webhooks change nothing", async () => {
  const c = await pay.createPayment({ userId: alice.id, purpose: "SUBSCRIPTION", amountTwd: low.feeTwd, planId: low.id, buyer });
  const tx = oen.pay((await db.payment.findUniqueOrThrow({ where: { id: c.id } })).oenId!);
  const r = await pay.handleWebhook(oen.webhook(tx));
  assert.equal(r.status, "CONFIRMED");
  await pay.handleWebhook(oen.webhook(tx));
  await pay.syncPayment(c.id);
  await pay.handleWebhook({ ...oen.webhook(tx), status: "charging" }); // out-of-order notification
  const periods = await db.subscription.findMany({ where: { paymentId: c.id } });
  assert.equal(periods.length, 1);
  const st = await subs.subscriptionState(alice.id);
  assert.equal(st.current?.plan, "low");
  assert.ok(Math.abs(st.endsAt!.getTime() - Date.now() - 30 * DAY) < 60_000);
  assert.ok(Math.abs(st.graceEndsAt!.getTime() - st.endsAt!.getTime() - 30 * DAY) < 1000, "30-day grace");
});

test("extensions stack after the current period", async () => {
  const before = (await subs.subscriptionState(alice.id)).endsAt!;
  const c = await pay.createPayment({ userId: alice.id, purpose: "SUBSCRIPTION", amountTwd: high.feeTwd, planId: high.id, buyer });
  oen.pay((await txOf(c.id)).transactionId);
  await pay.syncPayment(c.id);
  const st = await subs.subscriptionState(alice.id);
  assert.equal(st.upcoming.length, 1);
  assert.equal(st.upcoming[0].startsAt.getTime(), before.getTime(), "starts when the current one ends");
  assert.equal(st.upcoming[0].plan, "high");
  assert.equal(st.endsAt!.getTime(), before.getTime() + 30 * DAY);
});

test("forged webhooks: unknown ids never reach Oen; the body is never trusted", async () => {
  const calls = oen.calls.length;
  assert.equal((await pay.handleWebhook({ id: "x".repeat(27), status: "charged", amount: 3675 })).ignored, "unknown transaction");
  assert.equal((await pay.handleWebhook({ hello: 1 })).ignored, "no transaction id");
  assert.equal(oen.calls.length, calls, "no API call for unknown ids");
  // a real id, but the customer has not paid: the body says charged, Oen says initiated
  const c = await pay.createPayment({ userId: alice.id, purpose: "TASK_TOPUP", amountTwd: 50, buyer });
  const tx = await txOf(c.id);
  const r = await pay.handleWebhook({ ...oen.webhook(tx), status: "charged", success: true });
  assert.equal(r.status, "PENDING");
  // amount tampering on Oen's side is caught too (transaction must match order and amount)
  tx.amount = 1;
  tx.status = "charged";
  await assert.rejects(pay.syncPayment(c.id), /does not match/);
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: c.id } })).status, "PENDING");
  assert.ok(await db.adminAudit.findFirst({ where: { action: "payment.mismatch", targetId: c.id } }));
});

test("failure: declined payment → FAILED, nothing granted; task stays unpaid", async () => {
  const task = await tasks.createTask(alice.id, tasks.TaskInput.parse({ title: "Sales report", prompt: "Summarise the sales data for Q3", model: "anthropic/claude-sonnet-5-5", budget: 100 }));
  assert.equal(Number(task.usdTwdRate), 32.5);
  assert.equal(Number(task.priceBuffer), 1.08);
  assert.deepEqual(task.modelPriceUsd, { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 });
  const c = await pay.createPayment({ userId: alice.id, purpose: "TASK_BUDGET", amountTwd: 100, taskId: task.id, buyer });
  oen.pay((await txOf(c.id)).transactionId, "failed");
  await pay.handleWebhook(oen.webhook(await txOf(c.id)));
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: c.id } })).status, "FAILED");
  const t = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(t.status, "AWAITING_PAYMENT");
  assert.equal(Number(t.budget), 0);

  // paying again (new checkout) funds and queues it
  const c2 = await pay.createPayment({ userId: alice.id, purpose: "TASK_BUDGET", amountTwd: 100, taskId: task.id, buyer });
  oen.pay((await txOf(c2.id)).transactionId);
  await pay.syncPayment(c2.id);
  const t2 = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(t2.status, "QUEUED");
  assert.equal(Number(t2.budget), 100);
});

test("reconciliation settles a payment whose webhook never came and expires abandoned checkouts", async () => {
  const paid = await pay.createPayment({ userId: alice.id, purpose: "TASK_TOPUP", amountTwd: 30, buyer });
  const gone = await pay.createPayment({ userId: alice.id, purpose: "TASK_TOPUP", amountTwd: 40, buyer });
  const cvs = await pay.createPayment({ userId: alice.id, purpose: "TASK_TOPUP", amountTwd: 60, buyer });
  oen.pay((await txOf(paid.id)).transactionId);
  oen.pay((await txOf(cvs.id)).transactionId, "charging");
  await db.payment.updateMany({ where: { id: { in: [paid.id, gone.id, cvs.id] } }, data: { createdAt: new Date(Date.now() - 30 * 60_000), checkoutExpiresAt: new Date(Date.now() - 25 * 60_000) } });
  await pay.reconcilePayments();
  const st = async (id: string) => (await db.payment.findUniqueOrThrow({ where: { id } })).status;
  assert.equal(await st(paid.id), "CONFIRMED");
  assert.equal(await st(gone.id), "EXPIRED");
  assert.equal(await st(cvs.id), "PENDING", "convenience-store payments get 3 days");
  // the customer pays at the store later: still accepted
  oen.pay((await txOf(cvs.id)).transactionId);
  await pay.handleWebhook(oen.webhook(await txOf(cvs.id)));
  assert.equal(await st(cvs.id), "CONFIRMED");
});

test("refund: once per transaction; subscription refund cancels the period and later ones move up", async () => {
  const st0 = await subs.subscriptionState(alice.id);
  const current = await db.subscription.findUniqueOrThrow({ where: { id: st0.current!.id } });
  const upcoming = st0.upcoming[0];
  const r = await pay.refundPayment(admin.id, current.paymentId, { reason: "changed mind" });
  assert.equal(r.status, "REFUNDED");
  assert.equal(r.refundedTwd, 840);
  await assert.rejects(pay.refundPayment(admin.id, current.paymentId, {}), /already refunded/);
  const st = await subs.subscriptionState(alice.id);
  assert.equal(st.current?.id, upcoming.id, "the prepaid period starts now");
  assert.ok(Math.abs(st.endsAt!.getTime() - Date.now() - 30 * DAY) < 60_000);
  assert.ok(await db.adminAudit.findFirst({ where: { action: "payment.refund", targetId: current.paymentId } }));
});

test("task refunds are limited to the unspent budget and reduce it", async () => {
  const task = await tasks.createTask(alice.id, tasks.TaskInput.parse({ title: "Another one", prompt: "Draft the weekly newsletter", model: "anthropic/claude-haiku-5-5", budget: 200 }));
  const c = await pay.createPayment({ userId: alice.id, purpose: "TASK_BUDGET", amountTwd: 200, taskId: task.id, buyer });
  oen.pay((await txOf(c.id)).transactionId);
  await pay.syncPayment(c.id);
  await db.task.update({ where: { id: task.id }, data: { charged: 57.2, status: "COMPLETED" } });
  const p = await db.payment.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(await pay.refundable(p), 142, "200 − ceil(57.2)");
  await assert.rejects(pay.refundPayment(admin.id, c.id, { amount: 150 }), /between 1 and 142/);
  const r = await pay.refundPayment(admin.id, c.id, { amount: 142, reason: "unused budget" });
  assert.equal(r.status, "CONFIRMED", "partial refund keeps the payment confirmed");
  assert.equal(Number((await db.task.findUniqueOrThrow({ where: { id: task.id } })).budget), 58);
  assert.equal((await txOf(c.id)).refundAmount, 142);
});

test("a refund made in the Oen CRM is picked up by sync", async () => {
  const c = await pay.createPayment({ userId: alice.id, purpose: "SUBSCRIPTION", amountTwd: low.feeTwd, planId: low.id, buyer });
  oen.pay((await txOf(c.id)).transactionId);
  await pay.syncPayment(c.id);
  const tx = await txOf(c.id);
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
