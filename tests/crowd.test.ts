import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { useTestDb } from "./helpers/testdb";
import { StubOen } from "./helpers/stub-oen";

const { dir } = useTestDb();
const oen = new StubOen();
process.env.PAYMENT_MODE = "oen";
process.env.OEN_MERCHANT_ID = oen.merchant;
process.env.OEN_API_TOKEN = oen.token;
process.env.OEN_RECHECK_MS = "10";
process.env.STORAGE_LOCAL_DIR = path.join(dir, "storage");
// keep the spec dialogue on the development stand-in (no model keys)
delete process.env.ANTHROPIC_API_KEY;

let db: typeof import("../src/lib/db").db;
let pay: typeof import("../src/lib/payments");
let proposal: typeof import("../src/lib/crowd/proposal");
let spec: typeof import("../src/lib/crowd/spec-agent");
let cards: typeof import("../src/lib/crowd/cards");
let pledges: typeof import("../src/lib/crowd/pledges");
let life: typeof import("../src/lib/crowd/lifecycle");
let points: typeof import("../src/lib/crowd/points");
let rules: typeof import("../src/lib/crowd/rules");
let agent: typeof import("../src/lib/crowd/agent");
let subs: typeof import("../src/lib/subscriptions");
let plans: typeof import("../src/lib/plans");
type U = Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;
let ann: U, bob: U, cat: U, dan: U;
const buyer = { name: "王小明", email: "ming@example.com" };
const DAY = 86400_000;
const MODEL = "anthropic/claude-sonnet-5-5";

before(async () => {
  await oen.start();
  process.env.OEN_API_BASE = oen.url;
  ({ db } = await import("../src/lib/db"));
  pay = await import("../src/lib/payments");
  proposal = await import("../src/lib/crowd/proposal");
  spec = await import("../src/lib/crowd/spec-agent");
  cards = await import("../src/lib/crowd/cards");
  pledges = await import("../src/lib/crowd/pledges");
  life = await import("../src/lib/crowd/lifecycle");
  points = await import("../src/lib/crowd/points");
  rules = await import("../src/lib/crowd/rules");
  agent = await import("../src/lib/crowd/agent");
  subs = await import("../src/lib/subscriptions");
  plans = await import("../src/lib/plans");
  const mk = (n: string, h: string) => db.user.create({ data: { account: "0x" + n.repeat(40), handle: h } });
  [ann, bob, cat, dan] = await Promise.all([mk("a", "ann"), mk("b", "bob"), mk("c", "cat"), mk("d", "dan")]);
});
after(() => oen.stop());

const txOf = async (paymentId: string) => oen.txs.get((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).oenId!)!;

/** Pay a proposal fee with a saved card (charged right away) */
async function payFee(userId: string, taskId: string) {
  const c = await proposal.buyProposalFee(userId, taskId, buyer, await anyCard(userId));
  assert.equal(c.status, "CONFIRMED");
}

/** Save a card for a user through the token checkout + token notification */
async function saveCard(userId: string, behaviour = "ok") {
  const b = await cards.startBinding(userId, { returnTo: "/account" });
  const card = await db.savedCard.findUniqueOrThrow({ where: { id: b.id } });
  const r = await pay.handleWebhook(oen.bindCard(card.bindingId, true, behaviour));
  assert.equal(r.status, "active");
  return card.id;
}

/** A proposal opened for pledges with a goal of `goal` TWD */
async function openCampaign(goal: number, opts: { days?: number; startEarly?: boolean } = {}) {
  const t = await proposal.createDraft(ann.id, { title: `Crowd ${goal}`, description: "Collect and compare public transport data", model: MODEL });
  await payFee(ann.id, t.id);
  await proposal.saveSpec(ann.id, t.id, { summary: "s", deliverables: ["report.md"], method: ["collect", "analyse"], acceptance: ["covers every city"], estimate: { p50Twd: goal / 2, p90Twd: goal * 0.9 } });
  return screened(proposal.openFunding(ann.id, t.id, { durationDays: opts.days ?? 7, goalTwd: goal, startEarly: opts.startEarly ?? false }));
}

test("rules: goals in whole shares, fee by period, file blocks", () => {
  assert.equal(rules.sharePrice(), 30);
  assert.deepEqual(rules.durations().map((d) => d.days), [7, 30, 90]);
  assert.equal(rules.feeRate(7), 0);
  assert.equal(rules.feeRate(30), 0.03);
  assert.throws(() => rules.feeRate(14), /7, 30, 90 days/);
  assert.equal(rules.minimumGoal(540, 0), 540);
  assert.equal(rules.minimumGoal(540, 0.03), 570, "540 ÷ 0.97 = 556.7 → 19 shares");
  assert.equal(rules.minimumGoal(1, 0), 30);
  assert.equal(rules.fileBlocks(50 * 1048576), 0);
  assert.equal(rules.fileBlocks(50 * 1048576 + 1), 1);
  assert.equal(rules.fileBlocks(151 * 1048576), 3);
});

test("proposal: fee credit, spec dialogue charged to it, files, opening checks", async () => {
  const t = await proposal.createDraft(ann.id, { title: "Taipei MRT ridership", description: "Analyse MRT ridership by station for 2025", model: MODEL });
  assert.equal(t.status, "DRAFT");
  assert.equal(t.isPublic, true);
  await assert.rejects(spec.specTurn(ann.id, t.id, "hello"), /proposal fee/);
  await assert.rejects(proposal.openFunding(ann.id, t.id, { durationDays: 7, startEarly: false }), /proposal fee/);
  await assert.rejects(spec.specTurn(bob.id, t.id, "hello"), /not found/, "only the proposer");

  await payFee(ann.id, t.id);
  let row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(Number(row.proposalCreditTwd), 30);
  assert.equal(row.status, "DRAFT", "the fee does not queue the task");
  assert.equal(Number(row.budget), 0);
  const p = await db.payment.findFirstOrThrow({ where: { taskId: t.id, purpose: "CROWD_PROPOSAL" } });
  assert.equal(await pay.refundable(p), 0, "the proposal fee is non-refundable");
  assert.deepEqual([...oen.txs.values()].find((x) => x.orderId === p.id)!.body.productDetails, [{ productionCode: "CROWD-PROPOSAL", description: "眾籌提案費", quantity: 1, unit: "式", unitPrice: 30 }]);

  const r = await spec.specTurn(ann.id, t.id, "請幫我起草規格");
  assert.ok(r.reply.length > 0);
  assert.ok(r.spec && r.spec.deliverables.length > 0, "the dialogue drafted a spec");
  assert.ok(r.costTwd > 0 && r.creditLeft < 30);
  row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal((row.specChat as unknown[]).length, 2);
  assert.equal(row.specVersion, 1);

  // reference files: storage cost only up to 50 MB, then one share of credit per started 50 MB block
  const small = await proposal.addFile(ann.id, t.id, { filename: "../stations.csv", contentType: "text/csv", data: Buffer.from("a,b\n1,2\n"), visibility: "PUBLIC" });
  assert.equal(small.file.filename, ".._stations.csv", "no path separators");
  assert.equal(small.cost.blocks, 0);
  assert.ok(small.cost.total < 0.01);
  await assert.rejects(proposal.addFile(ann.id, t.id, { filename: "big.bin", contentType: "", data: Buffer.alloc(51 * 1048576), visibility: "AGENT" }), /credit used up/, "a block costs 30 and the credit is below that");
  await payFee(ann.id, t.id);
  const big = await proposal.addFile(ann.id, t.id, { filename: "big.bin", contentType: "", data: Buffer.alloc(51 * 1048576), visibility: "AGENT" });
  assert.equal(big.cost.blocks, 1);

  // opening: spec must be complete, goal ≥ P90 + fee in whole shares
  await proposal.saveSpec(ann.id, t.id, { summary: "MRT ridership", deliverables: ["report.md"], method: ["download", "analyse"], acceptance: [], estimate: { p50Twd: 300, p90Twd: 540 } });
  await assert.rejects(proposal.openFunding(ann.id, t.id, { durationDays: 30, startEarly: false }), /missing: acceptance/);
  await proposal.saveSpec(ann.id, t.id, { summary: "MRT ridership", deliverables: ["report.md"], method: ["download", "analyse"], acceptance: ["every station"], estimate: { p50Twd: 300, p90Twd: 540 } });
  await assert.rejects(proposal.openFunding(ann.id, t.id, { durationDays: 30, goalTwd: 540, startEarly: false }), /at least 570/);
  await assert.rejects(proposal.openFunding(ann.id, t.id, { durationDays: 30, goalTwd: 575, startEarly: false }), /multiple of 30/);
  const opened = await screened(proposal.openFunding(ann.id, t.id, { durationDays: 30, startEarly: false }));
  assert.equal(opened.status, "FUNDING");
  assert.equal(opened.goalTwd, 570);
  assert.equal(Number(opened.serviceFeeRate), 0.03);
  assert.ok(Math.abs(opened.deadlineAt!.getTime() - Date.now() - 30 * DAY) < 60_000);
  assert.match(opened.prompt, /## Acceptance criteria\n1\. every station/);
  await assert.rejects(proposal.saveSpec(ann.id, t.id, {}), /already open/, "the spec is frozen once open");
  const status = await db.comment.findFirst({ where: { targetId: t.id, kind: "status" }, include: { user: true } });
  assert.equal(status?.user.account, agent.AGENT_ACCOUNT, "the agent announced the campaign");
});

test("cards: token notification saves the card once; forged and repeated notices are ignored", async () => {
  const b = await cards.startBinding(bob.id, { returnTo: "/tasks/x" });
  assert.match(b.url, /\/checkout\/subscription\/create\//);
  const card = await db.savedCard.findUniqueOrThrow({ where: { id: b.id } });
  assert.equal(card.status, "pending");
  const binding = oen.bindings.get(card.bindingId)!;
  assert.equal(binding.customId, bob.id);
  assert.match(String(binding.body.successUrl), /\/tasks\/x$/);

  assert.equal((await pay.handleWebhook({ purpose: "token", id: "x".repeat(27), success: true, token: "stolen-token-123" })).ignored, "unknown binding");
  const notice = oen.bindCard(card.bindingId);
  assert.equal((await pay.handleWebhook({ ...notice, customId: cat.id })).ignored, "customId mismatch");
  assert.equal((await pay.handleWebhook(notice)).status, "active");
  assert.equal((await pay.handleWebhook({ ...notice, token: "another-token-999" })).ignored, "already applied");
  const saved = await db.savedCard.findUniqueOrThrow({ where: { id: card.id } });
  assert.equal(saved.last4, "4242");
  assert.ok(saved.tokenSealed?.startsWith("enc:v1:"), "token stored sealed");
  assert.equal(cards.cardToken(saved), notice.token);

  // abandoned 3-D Secure
  const b2 = await cards.startBinding(bob.id, { returnTo: "/account" });
  const c2 = await db.savedCard.findUniqueOrThrow({ where: { id: b2.id } });
  assert.equal((await pay.handleWebhook(oen.bindCard(c2.bindingId, false))).status, "failed");
  assert.equal((await cards.activeCards(bob.id)).length, 1);
});

test("unfunded: nothing is charged, points come back, the card is never used", async () => {
  const t = await openCampaign(300);
  await points.bookPoints({ userId: cat.id, delta: 100, reason: "admin", ref: "test:cat" });
  await assert.rejects(pledges.pledge(cat.id, t.id, { shares: 5, source: "POINTS" }), /not enough points/);
  await pledges.pledge(cat.id, t.id, { shares: 1, source: "POINTS" });
  assert.equal(await points.pointBalance(cat.id), 70);
  await assert.rejects(pledges.pledge(dan.id, t.id, { shares: 1, source: "CARD", buyer }), /save a card/);
  const p = await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  assert.equal(p.status, "ACTIVE");
  await assert.rejects(pledges.pledge(bob.id, t.id, { shares: 3 as 1, source: "CARD", buyer }));
  const calls = oen.calls.length;
  await db.task.update({ where: { id: t.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(after.status, "UNFUNDED");
  assert.equal(oen.calls.slice(calls).filter((c) => c.includes("/token/transactions")).length, 0, "no charge");
  assert.equal(await points.pointBalance(cat.id), 100, "points returned");
  assert.equal((await db.pledge.findUniqueOrThrow({ where: { id: p.id } })).status, "RELEASED");
  assert.ok(await db.notification.findFirst({ where: { userId: bob.id, type: "crowd.unfunded" } }), "backers notified");
});

test("withdrawing a pledge while the campaign is open", async () => {
  const t = await openCampaign(300);
  const p = await pledges.pledge(cat.id, t.id, { shares: 1, source: "POINTS" });
  await assert.rejects(pledges.cancelPledge(bob.id, p.id), /not found/);
  await pledges.cancelPledge(cat.id, p.id);
  assert.equal(await points.pointBalance(cat.id), 100);
  assert.equal((await db.pledge.findUniqueOrThrow({ where: { id: p.id } })).status, "CANCELLED");
});

test("funded: one charge per backer, fee and proposal credit, declined card retried with a new card", async () => {
  await saveCard(cat.id, "T0004"); // cat's card will be declined
  const t = await openCampaign(600, { days: 30 });
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  await pledges.pledge(cat.id, t.id, { shares: 5, source: "CARD", buyer });
  await pledges.pledge(cat.id, t.id, { shares: 1, source: "POINTS" });
  await pledges.pledge(ann.id, t.id, { shares: 5, source: "POINTS" }).catch(() => undefined); // ann has no points
  // pledged 300 (bob) + 150 (cat card) + 30 (cat points) = 480 < 600: add dan
  await saveCard(dan.id);
  await pledges.pledge(dan.id, t.id, { shares: 5, source: "CARD", buyer });
  assert.equal((await pledges.pledgeTotals(t.id)).pledged, 630);
  await db.task.update({ where: { id: t.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();

  let row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  // bob 300 + dan 150 charged, cat's card declined; collected 300 + 150 + 30 = 480 < 600 → still charging
  assert.equal(row.status, "CHARGING");
  const charges = await db.payment.findMany({ where: { taskId: t.id, purpose: "CROWD_PLEDGE" } });
  assert.equal(charges.filter((c) => c.userId === bob.id && c.status === "CONFIRMED").length, 1, "bob's two pledges in one charge");
  assert.equal(charges.find((c) => c.userId === bob.id)!.amountTwd, 300);
  const bobTx = [...oen.txs.values()].find((x) => x.orderId === charges.find((c) => c.userId === bob.id)!.id)!;
  assert.deepEqual(bobTx.body.productDetails, [{ productionCode: "CROWD-PLEDGE", description: `眾籌出資：${t.title}`, quantity: 10, unit: "份", unitPrice: 30 }]);
  assert.equal(bobTx.body.userEmail, buyer.email, "e-invoice buyer");
  assert.equal(charges.find((c) => c.userId === cat.id)!.status, "FAILED");
  assert.ok(await db.notification.findFirst({ where: { userId: cat.id, type: "crowd.charge_failed" } }));

  // the tick does not hammer a declined card
  const before = oen.calls.filter((c) => c.includes("/token/transactions")).length;
  await life.crowdTick();
  assert.equal(oen.calls.filter((c) => c.includes("/token/transactions")).length, before);

  // cat saves a working card → retried at once → funded
  await saveCard(cat.id);
  row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal((await db.pledge.findMany({ where: { taskId: t.id, userId: cat.id, source: "CARD" } }))[0].status, "CHARGED");
  await life.crowdTick();
  row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "QUEUED");
  // collected 630, fee 3 % = 19 (18.9 rounded), unused proposal credit added
  assert.equal(row.serviceFeeTwd, 19);
  const credit = Number(row.proposalToBudgetTwd);
  assert.ok(credit > 0 && credit <= 30);
  assert.ok(Math.abs(Number(row.budget) - (630 - 19 + credit)) < 1e-6);
  assert.ok(row.fundedAt);
  assert.ok(await db.notification.findFirst({ where: { userId: dan.id, type: "crowd.funded" } }));

  // settlement: the backers' share of the leftover becomes points, the proposal-credit share does not
  await db.task.update({ where: { id: t.id }, data: { charged: 300.4, status: "COMPLETED" } });
  const bobPts = await points.pointBalance(bob.id);
  await life.settleTask(t.id);
  await life.settleTask(t.id);
  row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.ok(row.settledAt);
  const leftover = Math.floor(Number(row.budget) - 301);
  const forBackers = leftover * (611.1 / (611.1 + credit));
  const bobShare = (await points.pointBalance(bob.id)) - bobPts;
  assert.ok(Math.abs(bobShare - Math.floor(forBackers * (300 / 630) * 0.5) - Math.floor(forBackers * (300 / 630) * 0.5)) <= 1, `bob gets his share (${bobShare})`);
  const given = (await db.pledge.findMany({ where: { taskId: t.id } })).reduce((a, p) => a + p.returnedTwd, 0);
  assert.ok(given <= forBackers && given >= forBackers - 6, "floored per pledge, proposal part kept");
  assert.equal(await db.pointLedger.count({ where: { ref: { startsWith: "leftover:" }, taskId: t.id } }), (await db.pledge.count({ where: { taskId: t.id, returnedTwd: { gt: 0 } } })), "settled once");
});

test("start early: charged as soon as the goal is reached; later pledges go straight into the budget", async () => {
  const t = await openCampaign(150, { startEarly: true });
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  let row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "QUEUED", "funded without waiting for the deadline");
  const budget = Number(row.budget);
  await pledges.pledge(dan.id, t.id, { shares: 1, source: "CARD", buyer });
  row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(Number(row.budget), budget + 30, "7-day campaign: no fee");
  // a task that ran out of budget resumes when someone pledges
  await db.task.update({ where: { id: t.id }, data: { status: "NEEDS_FUNDING" } });
  await pledges.pledge(cat.id, t.id, { shares: 1, source: "POINTS" });
  row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "QUEUED");
  assert.equal(Number(row.budget), budget + 60);
});

test("charging falls short when the grace period ends: charged cards are refunded in full", async () => {
  await saveCard(ann.id, "T0005");
  const t = await openCampaign(300);
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  await pledges.pledge(ann.id, t.id, { shares: 5, source: "CARD", buyer });
  await db.task.update({ where: { id: t.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status, "CHARGING");
  await db.task.update({ where: { id: t.id }, data: { chargeDeadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "UNFUNDED");
  const bobPay = await db.payment.findFirstOrThrow({ where: { taskId: t.id, userId: bob.id, purpose: "CROWD_PLEDGE" } });
  assert.equal(bobPay.status, "REFUNDED");
  const tx = [...oen.txs.values()].find((x) => x.orderId === bobPay.id)!;
  assert.equal(tx.refundAmount, 150, "one full refund");
});

test("quota pledges: need a subscription, capped per task, returned as quota", async () => {
  const t = await openCampaign(300);
  await assert.rejects(pledges.pledge(dan.id, t.id, { shares: 1, source: "QUOTA" }), /subscription/);
  const danPoints = await points.pointBalance(dan.id);
  const plan = (await plans.listPlans()).find((p) => p.code === "high")!;
  await subs.addPeriod(dan.id, "sub-test-dan", { id: plan.id, code: plan.code, days: 30 });
  await pledges.pledge(dan.id, t.id, { shares: 5, source: "QUOTA" });
  await assert.rejects(pledges.pledge(dan.id, t.id, { shares: 1, source: "QUOTA" }), /at most 150 TWD/, "50 % of the goal");
  const used = await db.usageLedger.aggregate({ where: { userId: dan.id }, _sum: { settledTwd: true } });
  assert.equal(Number(used._sum.settledTwd), 150);
  await db.task.update({ where: { id: t.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status, "UNFUNDED");
  const back = await db.usageLedger.aggregate({ where: { userId: dan.id }, _sum: { settledTwd: true } });
  assert.equal(Number(back._sum.settledTwd), 0, "quota given back");
  assert.equal(await points.pointBalance(dan.id), danPoints, "never as points");
});

test("worker events become agent comments and notify the audience", async () => {
  const t = await openCampaign(300);
  await agent.mirrorEvent(t.id, "run.started", "Run started");
  await agent.mirrorEvent(t.id, "log", "noise");
  const c = await db.comment.findMany({ where: { targetId: t.id, kind: "status" }, orderBy: { createdAt: "asc" } });
  assert.equal(c.at(-1)?.body, "Run started");
  assert.ok(!c.some((x) => x.body === "noise"));
  assert.ok(await db.notification.findFirst({ where: { userId: ann.id, type: "crowd.run.started" } }), "the proposer is told");
});

/** submit, then let the worker screen it (as the worker loop does) */
async function screened(p: Promise<{ id: string }>) {
  const t = await p;
  const { screeningTick } = await import("../src/lib/crowd/screening");
  await screeningTick();
  const { db: d } = await import("../src/lib/db");
  await confirmAsAdmin(t.id);
  return d.task.findUniqueOrThrow({ where: { id: t.id } });
}

/** An admin confirms the AI's screening result (the step between the AI and the proposer) */
async function confirmAsAdmin(taskId: string) {
  const { db: d } = await import("../src/lib/db");
  const { confirmScreening } = await import("../src/lib/crowd/screening");
  const row = await d.task.findUniqueOrThrow({ where: { id: taskId } });
  if ((row.screening as { decision?: string } | null)?.decision !== "review") return;
  const reviewer = (await d.user.findFirst({ where: { handle: "screen-admin" } })) ?? (await d.user.create({ data: { account: "0x" + "9".repeat(39) + "1", handle: "screen-admin", role: "ADMIN", isAdmin: true } }));
  await confirmScreening(reviewer.id, taskId);
}

/** A saved card of the user (bound through the stub Oen when there is none): every payment charges one */
async function anyCard(userId: string) {
  const have = await db.savedCard.findFirst({ where: { userId, status: "active" } });
  if (have) return have.id;
  const b = await cards.startBinding(userId, { returnTo: "/account" });
  const card = await db.savedCard.findUniqueOrThrow({ where: { id: b.id } });
  await pay.handleWebhook(oen.bindCard(card.bindingId));
  return card.id;
}
