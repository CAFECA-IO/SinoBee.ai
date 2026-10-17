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
let review: typeof import("../src/lib/crowd/review");
let screening: typeof import("../src/lib/crowd/screening");
let rep: typeof import("../src/lib/crowd/reputation");
let explore: typeof import("../src/lib/crowd/explore");
let points: typeof import("../src/lib/crowd/points");
type U = Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;
let ann: U, bob: U, cat: U, admin: U;
const buyer = { name: "王小明", email: "ming@example.com" };
const MODEL = "anthropic/claude-sonnet-5-5";
const DAY = 86400_000;

before(async () => {
  await oen.start();
  process.env.OEN_API_BASE = oen.url;
  ({ db } = await import("../src/lib/db"));
  pay = await import("../src/lib/payments");
  proposal = await import("../src/lib/crowd/proposal");
  cards = await import("../src/lib/crowd/cards");
  pledges = await import("../src/lib/crowd/pledges");
  life = await import("../src/lib/crowd/lifecycle");
  review = await import("../src/lib/crowd/review");
  screening = await import("../src/lib/crowd/screening");
  rep = await import("../src/lib/crowd/reputation");
  explore = await import("../src/lib/crowd/explore");
  points = await import("../src/lib/crowd/points");
  const mk = (n: string, h: string, extra = {}) => db.user.create({ data: { account: "0x" + n.repeat(40), handle: h, ...extra } });
  [ann, bob, cat, admin] = await Promise.all([mk("a", "ann", { kycLevel: 2 }), mk("b", "bob", { kycLevel: 1 }), mk("c", "cat"), mk("e", "admin", { role: "ADMIN", isAdmin: true })]);
  for (const u of [bob, cat]) {
    const b = await cards.startBinding(u.id, { returnTo: "/account" });
    const card = await db.savedCard.findUniqueOrThrow({ where: { id: b.id } });
    await pay.handleWebhook(oen.bindCard(card.bindingId));
  }
});
after(() => {
  oen.stop();
  delete process.env.CROWD_SCREENING;
  delete process.env.CROWD_PLEDGE_MIN_KYC;
  delete process.env.CROWD_VOTE_MIN_KYC;
});

const txOf = async (paymentId: string) => oen.txs.get((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).oenId!)!;

async function submit(title: string, opts: { goal?: number; category?: "data" | "research"; description?: string } = {}) {
  const goal = opts.goal ?? 150;
  const t = await proposal.createDraft(ann.id, { title, description: opts.description ?? "Collect public bus timetables and compare them", model: MODEL });
  await db.task.update({ where: { id: t.id }, data: { category: opts.category ?? "data" } });
  const c = await proposal.buyProposalFee(ann.id, t.id, buyer);
  oen.pay((await txOf(c.id)).transactionId);
  await pay.syncPayment(c.id);
  await proposal.saveSpec(ann.id, t.id, { summary: "s", deliverables: ["report.md"], method: ["collect"], acceptance: ["covers every route"], estimate: { p50Twd: 50, p90Twd: goal * 0.9 } });
  return screened(proposal.openFunding(ann.id, t.id, { durationDays: 7, goalTwd: goal, startEarly: false }));
}

test("screening: every checklist item must pass; a failed item sends the proposal back with the reasons", async () => {
  const ok = await submit("Bus timetables");
  assert.equal(ok.status, "FUNDING");
  const sc = ok.screening as { by: string; passed: number; total: number; checklistVersion: number };
  assert.equal(sc.by, "ai");
  assert.equal(sc.checklistVersion, 1);
  assert.ok(sc.total >= 100);
  assert.equal(sc.passed, sc.total, "all items passed");
  assert.ok(ok.deadlineAt);
  assert.equal(ok.termsVersion, 1, "the proposer agreed to checklist version 1");

  const flagged = await submit("Scrape everyone's phone numbers [review]");
  assert.equal(flagged.status, "DRAFT", "decided by the AI, no admin step");
  assert.equal(flagged.deadlineAt, null, "the period has not started");
  const fs = flagged.screening as { decision: string; failed: { id: string }[]; reasons: string[]; passed: number; total: number };
  assert.equal(fs.decision, "rejected");
  assert.deepEqual(fs.failed.map((f) => f.id), ["L01"]);
  assert.match(fs.reasons[0], /^L01 任務目的與內容符合中華民國法令/);
  assert.equal(fs.passed, fs.total - 1);
  assert.ok(await db.notification.findFirst({ where: { userId: ann.id, type: "crowd.screening_rejected" } }));
  await assert.rejects(pledges.pledge(bob.id, flagged.id, { shares: 1, source: "CARD", buyer }), /not taking pledges/);
  assert.ok(!(await explore.listCampaigns({})).some((c) => c.id === flagged.id));
  assert.equal((flagged.screening as { failedCount: number }).failedCount, 1, "result: passed and failed counts");
  assert.ok(await db.taskEvent.findFirst({ where: { taskId: flagged.id, type: "screening.rejected", message: { contains: `${fs.total - 1} of ${fs.total} checklist items met, 1 not met` } } }));
  // the admin can only ask for a re-review (with a note for the AI); the checklist result still decides
  await screening.rerunScreening(admin.id, flagged.id, "Phone numbers here are the bus operators' public service lines.");
  let back = await db.task.findUniqueOrThrow({ where: { id: flagged.id } });
  assert.equal(back.status, "SCREENING", "queued for the worker");
  assert.equal((back.screening as { decision: string }).decision, "queued");
  await screening.screeningTick();
  back = await db.task.findUniqueOrThrow({ where: { id: flagged.id } });
  assert.equal(back.status, "DRAFT", "still not met: sent back again");
  const again = back.screening as { notes: { text: string }[]; failedCount: number };
  assert.equal(again.failedCount, 1);
  assert.match(again.notes[0].text, /public service lines/, "the note is kept with the result");
  assert.ok(await db.adminAudit.findFirst({ where: { action: "crowd.screening.rerun", targetId: flagged.id } }));
  await assert.rejects(screening.rerunScreening(admin.id, ok.id), /not waiting/, "an open campaign cannot be re-screened");

  // fixed and resubmitted: screened again, opens, the period starts now
  await proposal.updateDraft(ann.id, flagged.id, { title: "Bus stop accessibility survey" });
  await db.task.update({ where: { id: flagged.id }, data: { prompt: "Survey bus stop accessibility from public data" } });
  await screened(proposal.openFunding(ann.id, flagged.id, { durationDays: 30, startEarly: false }));
  const row = await db.task.findUniqueOrThrow({ where: { id: flagged.id } });
  assert.equal(row.status, "FUNDING");
  assert.match(row.prompt, /Survey bus stop accessibility/, "description kept on resubmission");
  assert.equal(await db.specRevision.count({ where: { taskId: flagged.id } }), 1);
  assert.ok(Math.abs(row.deadlineAt!.getTime() - Date.now() - 30 * DAY) < 60_000, "30 days from opening");

  // a note that settles the failed item: the AI passes every item on re-review and the campaign opens
  const second = await submit("Weather station list [review]");
  assert.equal(second.status, "DRAFT");
  await screening.rerunScreening(admin.id, second.id, "The station list is published by the Central Weather Administration [clear]");
  assert.equal(await screening.screeningTick(), 1);
  const opened = await db.task.findUniqueOrThrow({ where: { id: second.id } });
  assert.equal(opened.status, "FUNDING");
  assert.equal((opened.screening as { passed: number; total: number; failedCount: number }).failedCount, 0);
  assert.ok(await db.notification.findFirst({ where: { userId: ann.id, type: "crowd.screening_passed" } }));
  await life.takedownCrowd(second.id, "test cleanup");

  process.env.CROWD_SCREENING = "off";
  assert.equal((await submit("Unscreened [review]")).status, "FUNDING");
  delete process.env.CROWD_SCREENING;
});

test("takedown: an open campaign is cancelled and every pledge returned; a funded one is only hidden", async () => {
  await points.bookPoints({ userId: cat.id, delta: 30, reason: "admin", ref: "p2:cat" });
  const t = await submit("Taken down soon");
  await pledges.pledge(bob.id, t.id, { shares: 1, source: "CARD", buyer });
  await pledges.pledge(cat.id, t.id, { shares: 1, source: "POINTS" });
  await life.takedownCrowd(t.id, "copyright");
  const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "CANCELLED");
  assert.equal(row.isPublic, false);
  assert.ok(row.takenDownAt);
  assert.equal(await points.pointBalance(cat.id), 30, "points returned");
  assert.equal(await db.payment.count({ where: { taskId: t.id, purpose: "CROWD_PLEDGE" } }), 0, "no charge");
  assert.ok(await db.notification.findFirst({ where: { userId: bob.id, type: "crowd.takedown" } }));

  const f = await submit("Funded then reported");
  await pledges.pledge(bob.id, f.id, { shares: 5, source: "CARD", buyer });
  await db.task.update({ where: { id: f.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  await life.takedownCrowd(f.id, "spam");
  const fr = await db.task.findUniqueOrThrow({ where: { id: f.id } });
  assert.equal(fr.status, "QUEUED", "paid work continues");
  assert.equal(fr.isPublic, false);
});

test("funding snapshots the model price at that moment, not at drafting", async () => {
  const t = await submit("Price snapshot");
  await db.task.update({ where: { id: t.id }, data: { usdTwdRate: 1, priceBuffer: 9 } });
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  await db.task.update({ where: { id: t.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, "QUEUED");
  assert.equal(Number(row.usdTwdRate), 32.5);
  assert.equal(Number(row.priceBuffer), 1.08);
});

test("KYC limits for pledging and voting (off by default)", async () => {
  const t = await submit("KYC gated");
  process.env.CROWD_PLEDGE_MIN_KYC = "1";
  await assert.rejects(pledges.pledge(cat.id, t.id, { shares: 1, source: "CARD", buyer }), /KYC level 1/);
  await pledges.pledge(bob.id, t.id, { shares: 5, source: "CARD", buyer });
  delete process.env.CROWD_PLEDGE_MIN_KYC;
  await db.task.update({ where: { id: t.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
  await life.crowdTick();
  await review.enterReview(t.id, { criteria: [] });
  process.env.CROWD_VOTE_MIN_KYC = "2";
  await assert.rejects(review.castVote(bob.id, t.id, true), /KYC level 2/);
  process.env.CROWD_VOTE_MIN_KYC = "1";
  await review.castVote(bob.id, t.id, true);
  delete process.env.CROWD_VOTE_MIN_KYC;
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status, "COMPLETED");
});

test("reputation and the explore listing", async () => {
  const r = await rep.reputation(ann.id);
  assert.equal(r.opened, 5, "taken-down and unscreened proposals do not count");
  assert.equal(r.funded, 2);
  assert.equal(r.decided, 2, "open campaigns are not counted as failures");
  assert.equal(r.accepted, 1, "the KYC test was accepted");
  assert.equal(r.firstPass, 1);
  assert.equal(r.kycLevel, 2);
  assert.equal(r.badge, "rising");
  assert.equal((await rep.reputation(bob.id)).backed >= 2, true);

  const a = await submit("Almost there", { category: "research" });
  const b = await submit("Barely started", { category: "research" });
  await pledges.pledge(bob.id, a.id, { shares: 5, source: "CARD", buyer });
  await pledges.pledge(bob.id, b.id, { shares: 1, source: "CARD", buyer });
  await pledges.pledge(cat.id, b.id, { shares: 1, source: "CARD", buyer });
  await db.task.update({ where: { id: b.id }, data: { deadlineAt: new Date(Date.now() + DAY) } });
  const almost = await explore.listCampaigns({ sort: "almost", category: "research" });
  assert.deepEqual(almost.map((c) => c.id).slice(0, 2), [a.id, b.id]);
  assert.equal(almost[0].pledged, 150);
  const ending = await explore.listCampaigns({ sort: "ending", category: "research" });
  assert.equal(ending[0].id, b.id);
  const popular = await explore.listCampaigns({ sort: "popular", category: "research" });
  assert.equal(popular[0].id, b.id, "two backers");
  assert.equal(popular[0].backers, 2);
  assert.deepEqual((await explore.listCampaigns({ q: "almost" })).map((c) => c.id), [a.id]);
  assert.ok((await explore.listCampaigns({ view: "funded" })).length >= 2);
  assert.ok(!(await explore.listCampaigns({ view: "funded" })).some((c) => c.title === "Funded then reported"), "taken down ones are hidden");
});

/** submit, then let the worker screen it (as the worker loop does) */
async function screened(p: Promise<{ id: string }>) {
  const t = await p;
  const { screeningTick } = await import("../src/lib/crowd/screening");
  await screeningTick();
  const { db: d } = await import("../src/lib/db");
  return d.task.findUniqueOrThrow({ where: { id: t.id } });
}
