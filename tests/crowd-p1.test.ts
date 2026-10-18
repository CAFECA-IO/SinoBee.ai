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

let db: typeof import("../src/lib/db").db;
let pay: typeof import("../src/lib/payments");
let proposal: typeof import("../src/lib/crowd/proposal");
let cards: typeof import("../src/lib/crowd/cards");
let pledges: typeof import("../src/lib/crowd/pledges");
let life: typeof import("../src/lib/crowd/lifecycle");
let points: typeof import("../src/lib/crowd/points");
let review: typeof import("../src/lib/crowd/review");
let agent: typeof import("../src/lib/crowd/agent");
let types: typeof import("../worker/types");
type U = Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;
let ann: U, bob: U, cat: U, dan: U, admin: U;
const buyer = { name: "王小明", email: "ming@example.com" };
const MODEL = "anthropic/claude-sonnet-5-5";
const HOUR = 3600_000;

before(async () => {
  await oen.start();
  process.env.OEN_API_BASE = oen.url;
  ({ db } = await import("../src/lib/db"));
  pay = await import("../src/lib/payments");
  proposal = await import("../src/lib/crowd/proposal");
  cards = await import("../src/lib/crowd/cards");
  pledges = await import("../src/lib/crowd/pledges");
  life = await import("../src/lib/crowd/lifecycle");
  points = await import("../src/lib/crowd/points");
  review = await import("../src/lib/crowd/review");
  agent = await import("../src/lib/crowd/agent");
  types = await import("../worker/types");
  const mk = (n: string, h: string, extra = {}) => db.user.create({ data: { account: "0x" + n.repeat(40), handle: h, ...extra } });
  [ann, bob, cat, dan, admin] = await Promise.all([mk("a", "ann"), mk("b", "bob"), mk("c", "cat"), mk("d", "dan"), mk("e", "admin", { role: "ADMIN", isAdmin: true })]);
  for (const u of [bob, cat, dan]) await saveCard(u.id);
});
after(() => oen.stop());

const txOf = async (paymentId: string) => oen.txs.get((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).oenId!)!;

async function saveCard(userId: string) {
  const b = await cards.startBinding(userId, { returnTo: "/account" });
  const card = await db.savedCard.findUniqueOrThrow({ where: { id: b.id } });
  await pay.handleWebhook(oen.bindCard(card.bindingId));
}

const SPEC = (p90: number, extra = {}) => ({ summary: "s", deliverables: ["report.md"], method: ["collect", "analyse"], acceptance: ["covers every city", "sources cited"], estimate: { p50Twd: p90 / 2, p90Twd: p90 }, ...extra });

async function openCampaign(goal: number, specExtra = {}) {
  const t = await proposal.createDraft(ann.id, { title: `Crowd ${goal}`, description: "Compare public transport fares in Asia", model: MODEL });
  await proposal.buyProposalFee(ann.id, t.id, buyer, await anyCard(ann.id));
  await proposal.saveSpec(ann.id, t.id, SPEC(goal * 0.9, specExtra));
  return screened(proposal.openFunding(ann.id, t.id, { durationDays: 7, goalTwd: goal, startEarly: false }));
}

const expire = (id: string) => db.task.update({ where: { id }, data: { deadlineAt: new Date(Date.now() - 1000) } });

/** bob 5 shares + cat 5 shares by card, then the deadline: funded with 300 */
async function funded(goal = 300, specExtra = {}) {
  const t = await openCampaign(goal, specExtra);
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  await pledges.pledge(cat.id, t.id, { shares: 5, source: "CARD", buyer });
  await expire(t.id);
  await life.crowdTick();
  const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "QUEUED");
  return row;
}

test("review: self-check shown, votes weighted by paid shares, accepted at the deadline, then settled", async () => {
  const t = await funded();
  await db.task.update({ where: { id: t.id }, data: { status: "RUNNING", charged: 100 } });
  await review.enterReview(t.id, { criteria: [{ criterion: "covers every city", passed: true, evidence: "report.md §2" }, { criterion: "sources cited", passed: false }], summary: "ok" });
  let row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "IN_REVIEW");
  assert.equal((row.acceptance as { criteria: unknown[] }).criteria.length, 2);
  assert.ok(row.reviewDeadlineAt && row.reviewDeadlineAt.getTime() > Date.now() + 6 * 24 * HOUR);
  assert.ok(await db.notification.findFirst({ where: { userId: bob.id, type: "crowd.review" } }));

  await assert.rejects(review.castVote(dan.id, t.id, true), /only backers/);
  await assert.rejects(review.castVote(bob.id, t.id, false), /reason is required/);
  await review.castVote(bob.id, t.id, true);
  await review.castVote(bob.id, t.id, false, "sources are missing");
  await review.castVote(bob.id, t.id, true); // changed his mind again; one vote per backer and round
  assert.equal(await db.acceptanceVote.count({ where: { taskId: t.id } }), 1);
  const tl = await review.tally(t.id, 0);
  assert.deepEqual([tl.yes, tl.no], [5, 0]);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status, "IN_REVIEW", "cat has not voted yet");

  await db.task.update({ where: { id: t.id }, data: { reviewDeadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "COMPLETED");
  assert.ok(row.settledAt, "settled after acceptance");
  assert.ok((await points.pointBalance(bob.id)) > 0);
});

test("review: rejected → rework with the reasons; rejected again → disputed → platform refund as points", async () => {
  const t = await funded();
  await db.task.update({ where: { id: t.id }, data: { charged: 100 } });
  await review.enterReview(t.id, { criteria: [] });
  await review.castVote(bob.id, t.id, false, "the Tokyo fares are missing");
  await review.castVote(cat.id, t.id, true);
  // everyone voted: closes at once; 5 yes vs 5 no meets the 50 % threshold
  let row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "COMPLETED", "a tie is accepted");

  const t2 = await funded();
  await db.task.update({ where: { id: t2.id }, data: { charged: 100 } });
  await review.enterReview(t2.id, { criteria: [] });
  await review.castVote(bob.id, t2.id, false, "the Tokyo fares are missing");
  await review.castVote(cat.id, t2.id, false, "no sources");
  row = await db.task.findUniqueOrThrow({ where: { id: t2.id } });
  assert.equal(row.status, "QUEUED", "rework queued");
  assert.equal(row.reworks, 1);
  assert.match(row.reworkNotes ?? "", /Tokyo fares/);
  // the rework prompt carries the reasons
  const prompt = types.buildPrompt({ ...row, user: ann, skillVersion: null } as never, "/w", true);
  assert.match(prompt, /REWORK/);
  assert.match(prompt, /Tokyo fares/);
  assert.match(prompt, /acceptance\.json/);

  await db.task.update({ where: { id: t2.id }, data: { charged: 150 } });
  await review.enterReview(t2.id, { criteria: [] });
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: t2.id } })).reworkNotes, null);
  await review.castVote(bob.id, t2.id, false, "still missing");
  await review.castVote(cat.id, t2.id, false, "still no sources");
  row = await db.task.findUniqueOrThrow({ where: { id: t2.id } });
  assert.equal(row.status, "DISPUTED", "no rework left (crowd.maxReworks = 1)");
  assert.ok(await db.notification.findFirst({ where: { userId: admin.id, type: "crowd.disputed" } }));

  const before = await points.pointBalance(cat.id);
  await assert.rejects(review.resolveDispute(admin.id, t.id, "refund"), /not disputed/);
  await review.resolveDispute(admin.id, t2.id, "refund", "deliverables do not match");
  row = await db.task.findUniqueOrThrow({ where: { id: t2.id } });
  assert.equal(row.status, "FAILED");
  const got = (await points.pointBalance(cat.id)) - before;
  // the whole budget (300 collected + unused proposal credit), not just the leftover, split by pledges
  assert.ok(got >= 145 && got <= 150, `cat gets about half of the 300 collected back (${got})`);
  assert.ok(await db.pointLedger.findFirst({ where: { userId: cat.id, reason: "platform", taskId: t2.id } }));
  assert.ok(await db.adminAudit.findFirst({ where: { action: "crowd.dispute", targetId: t2.id } }));
});

test("spec revision while funding: v2 published, backers told, no charge during the exit window", async () => {
  const t = await openCampaign(300);
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  await assert.rejects(proposal.reviseSpec(bob.id, t.id, SPEC(200), "x"), /not found/);
  await assert.rejects(proposal.reviseSpec(ann.id, t.id, SPEC(400), "bigger"), /at least 420/);
  const r = await proposal.reviseSpec(ann.id, t.id, SPEC(250, { acceptance: ["covers every city", "sources cited", "fares in TWD"] }), "add a TWD column");
  assert.equal(r.specVersion, 2);
  assert.ok(r.exitUntil && Math.abs(r.exitUntil.getTime() - Date.now() - 72 * HOUR) < 60_000);
  assert.match(r.prompt, /fares in TWD/);
  assert.match(r.prompt, /Compare public transport fares in Asia/, "description kept");
  assert.equal(await db.specRevision.count({ where: { taskId: t.id } }), 2);
  assert.ok(await db.notification.findFirst({ where: { userId: bob.id, type: "crowd.revised" } }));
  // deadline passes but the exit window is still open: nothing is charged
  await expire(t.id);
  await life.crowdTick();
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status, "FUNDING");
  assert.equal(await db.payment.count({ where: { taskId: t.id, purpose: "CROWD_PLEDGE" } }), 0);
  await db.task.update({ where: { id: t.id }, data: { exitUntil: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status, "QUEUED");
});

test("stretch goals unlock with money beyond the goal and reach the agent's instructions", async () => {
  const t = await openCampaign(150, { stretch: [{ title: "English edition", twd: 60 }, { title: "Charts", twd: 60 }, { title: "Video", twd: 500 }] });
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  await pledges.pledge(cat.id, t.id, { shares: 5, source: "CARD", buyer });
  await expire(t.id);
  await life.crowdTick();
  const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.stretchUnlocked, 2, "300 − 150 = 150 pays for 60 + 60");
  const prompt = types.buildPrompt({ ...row, user: ann, skillVersion: null } as never, "/w", false);
  assert.match(prompt, /stretch goals too; deliver them after the main deliverables: English edition; Charts\./);
  assert.ok(!prompt.includes("Video"));
  assert.ok(await db.comment.findFirst({ where: { targetId: t.id, kind: "status", body: { contains: "English edition" } } }));
});

test("top-up round: pledges wait for the round's goal, then are charged and the run resumes", async () => {
  const t = await funded();
  await db.task.update({ where: { id: t.id }, data: { status: "NEEDS_FUNDING", charged: 300 } });
  await assert.rejects(life.openTopup(bob.id, t.id, 60), /not found/);
  await assert.rejects(life.openTopup(ann.id, t.id, 50), /multiple of 30/);
  await life.openTopup(ann.id, t.id, 60);
  assert.ok(await db.notification.findFirst({ where: { userId: bob.id, type: "crowd.topup" } }));
  const budget = Number((await db.task.findUniqueOrThrow({ where: { id: t.id } })).budget);
  await pledges.pledge(dan.id, t.id, { shares: 1, source: "CARD", buyer });
  let row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "NEEDS_FUNDING", "30 of 60: waiting");
  assert.equal(await db.payment.count({ where: { taskId: t.id, userId: dan.id, purpose: "CROWD_PLEDGE" } }), 0, "not charged yet");
  await pledges.pledge(bob.id, t.id, { shares: 1, source: "CARD", buyer });
  row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "QUEUED");
  assert.equal(row.topupGoalTwd, null);
  assert.equal(Number(row.budget), budget + 60);

  // a round that misses its goal: nothing charged, the task closes with the results so far
  const t2 = await funded();
  await db.task.update({ where: { id: t2.id }, data: { status: "NEEDS_FUNDING", charged: 300 } });
  await life.openTopup(ann.id, t2.id, 300);
  const p = await pledges.pledge(dan.id, t2.id, { shares: 1, source: "CARD", buyer });
  await db.task.update({ where: { id: t2.id }, data: { topupDeadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  row = await db.task.findUniqueOrThrow({ where: { id: t2.id } });
  assert.equal(row.status, "COMPLETED");
  assert.ok(row.settledAt);
  assert.equal((await db.pledge.findUniqueOrThrow({ where: { id: p.id } })).status, "RELEASED");
  assert.equal(await db.payment.count({ where: { taskId: t2.id, userId: dan.id, purpose: "CROWD_PLEDGE" } }), 0);
});

test("points + card: the remainder is paid with points and the card is charged the rest", async () => {
  await points.bookPoints({ userId: dan.id, delta: 40, reason: "admin", ref: "p1:dan" });
  const t = await openCampaign(150);
  const p = await pledges.pledge(dan.id, t.id, { shares: 5, source: "CARD", buyer, usePoints: true });
  assert.equal(p.pointsTwd, 40);
  assert.equal(await points.pointBalance(dan.id), 0);
  await expire(t.id);
  await life.crowdTick();
  const charge = await db.payment.findFirstOrThrow({ where: { taskId: t.id, userId: dan.id, purpose: "CROWD_PLEDGE" } });
  assert.equal(charge.amountTwd, 110);
  assert.deepEqual([...oen.txs.values()].find((x) => x.orderId === charge.id)!.body.productDetails, [
    { productionCode: "CROWD-PLEDGE", description: `眾籌出資 5 份（點數折抵後）：${t.title}`, quantity: 1, unit: "式", unitPrice: 110 },
  ]);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status, "QUEUED", "110 + 40 points = 150");

  // unfunded: the points part comes back
  // points that cover the whole pledge: a points pledge, no card or buyer needed
  await points.bookPoints({ userId: dan.id, delta: 35, reason: "admin", ref: "p1:dan-all" });
  const tAll = await openCampaign(300);
  const all = await pledges.pledge(dan.id, tAll.id, { shares: 1, source: "CARD", usePoints: true });
  assert.deepEqual([all.source, all.pointsTwd, all.cardId], ["POINTS", 0, null]);
  assert.equal(await points.pointBalance(dan.id), 5);
  await points.bookPoints({ userId: dan.id, delta: -5, reason: "admin", ref: "p1:dan-all-reset" });

  await points.bookPoints({ userId: dan.id, delta: 20, reason: "admin", ref: "p1:dan2" });
  const t2 = await openCampaign(300);
  await pledges.pledge(dan.id, t2.id, { shares: 1, source: "CARD", buyer, usePoints: true });
  assert.equal(await points.pointBalance(dan.id), 0);
  await expire(t2.id);
  await life.crowdTick();
  assert.equal(await points.pointBalance(dan.id), 20);
});

test("reference notes for the agent: only reference comments, wrapped as untrusted data", async () => {
  const t = await openCampaign(300);
  await db.comment.create({ data: { targetType: "TASK", targetId: t.id, userId: bob.id, body: "See https://example.com/fares.csv", kind: "reference" } });
  await db.comment.create({ data: { targetType: "TASK", targetId: t.id, userId: cat.id, body: "nice idea!", kind: "comment" } });
  const n = await agent.referenceNotes(t.id);
  assert.equal(n.count, 1);
  assert.match(n.markdown, /UNTRUSTED DATA/);
  assert.match(n.markdown, /fares\.csv/);
  assert.ok(!n.markdown.includes("nice idea"));
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
