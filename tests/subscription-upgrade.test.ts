import { before, test } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "./helpers/testdb";

useTestDb();
let db: typeof import("../src/lib/db").db;
let subs: typeof import("../src/lib/subscriptions");
let plans: typeof import("../src/lib/plans");
const DAY = 86400_000;
type P = Awaited<ReturnType<typeof import("../src/lib/plans").listPlans>>[number];
let pro: P, ultra: P;

before(async () => {
  ({ db } = await import("../src/lib/db"));
  subs = await import("../src/lib/subscriptions");
  plans = await import("../src/lib/plans");
  const ps = await plans.listPlans();
  pro = ps.find((p) => p.code === "low")!;
  ultra = ps.find((p) => p.code === "high")!;
});

async function user(n: string) {
  return db.user.create({ data: { account: "0x" + n.repeat(40) } });
}
const close = (a: number, b: number, ms = 5_000) => Math.abs(a - b) < ms;

test("Pro → Ultra while Pro is running: Ultra starts now, unused Pro time becomes extra Ultra days, queued periods move up", async () => {
  const u = await user("a");
  const now = Date.now();
  // a Pro period that started 10 days ago (20 days left) and a second Pro period bought in advance
  await db.subscription.create({ data: { userId: u.id, plan: pro.code, planId: pro.id, startsAt: new Date(now - 10 * DAY), endsAt: new Date(now + 20 * DAY), paymentId: "pro-1" } });
  await db.subscription.create({ data: { userId: u.id, plan: pro.code, planId: pro.id, startsAt: new Date(now + 20 * DAY), endsAt: new Date(now + 50 * DAY), paymentId: "pro-2" } });

  const up = await subs.addPeriod(u.id, "ultra-1", { id: ultra.id, code: ultra.code, days: 30 });
  const credit = 20 * DAY * (pro.feeTwd / 30) / (ultra.feeTwd / 30); // 20 days of Pro at Ultra's daily price ≈ 4.57 days
  assert.ok(close(up.startsAt.getTime(), now), "Ultra starts now");
  assert.ok(close(up.endsAt.getTime(), now + 30 * DAY + credit), "30 days + the value of the unused Pro time");

  const st = await subs.subscriptionState(u.id);
  assert.equal(st.current?.plan, ultra.code, "the plan in effect is Ultra");
  const p1 = await db.subscription.findUniqueOrThrow({ where: { paymentId: "pro-1" } });
  assert.ok(close(p1.endsAt.getTime(), now), "the Pro period ended at the upgrade");
  const p2 = await db.subscription.findUniqueOrThrow({ where: { paymentId: "pro-2" } });
  assert.equal(p2.startsAt.getTime(), up.endsAt.getTime(), "the prepaid Pro period follows Ultra");
  assert.equal(p2.endsAt.getTime() - p2.startsAt.getTime(), 30 * DAY, "and keeps its 30 days");
  assert.equal(st.upcoming.length, 1);
});

test("Ultra → Pro (cheaper) and Pro → Pro stack after the running period as before", async () => {
  const u = await user("b");
  const first = await subs.addPeriod(u.id, "u-1", { id: ultra.id, code: ultra.code, days: 30 });
  const pro1 = await subs.addPeriod(u.id, "p-1", { id: pro.id, code: pro.code, days: 30 });
  assert.equal(pro1.startsAt.getTime(), first.endsAt.getTime(), "the cheaper plan waits for Ultra to end");
  const pro2 = await subs.addPeriod(u.id, "p-2", { id: pro.id, code: pro.code, days: 30 });
  assert.equal(pro2.startsAt.getTime(), pro1.endsAt.getTime());
  assert.equal((await subs.subscriptionState(u.id)).current?.plan, ultra.code);
});

test("a period bought earlier and queued behind a cheaper plan can be upgraded later (scripts/apply-upgrades)", async () => {
  const u = await user("c");
  const now = Date.now();
  await db.subscription.create({ data: { userId: u.id, plan: pro.code, planId: pro.id, startsAt: new Date(now - DAY), endsAt: new Date(now + 29 * DAY), paymentId: "c-pro" } });
  const queued = await db.subscription.create({ data: { userId: u.id, plan: ultra.code, planId: ultra.id, startsAt: new Date(now + 29 * DAY), endsAt: new Date(now + 59 * DAY), paymentId: "c-ultra" } });
  const up = await subs.upgradeNow(u.id, queued.id);
  assert.ok(up && close(up.startsAt.getTime(), now));
  assert.equal((await subs.subscriptionState(u.id)).current?.plan, ultra.code);
  assert.equal(await subs.upgradeNow(u.id, queued.id), null, "a running period is not upgraded twice");
});
