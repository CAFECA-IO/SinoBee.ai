import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { useTestDb } from "./helpers/testdb";

useTestDb();
process.env.OPENAI_API_KEY = "sk-test-openai";
process.env.ANTHROPIC_API_KEY = "sk-test-anthropic";

let db: typeof import("../src/lib/db").db;
let R: typeof import("../src/lib/llm/route");
let token = "";
let userId = "";
const LUNA = "openai/gpt-5.6-luna"; // cheap
const SONNET = "anthropic/claude-sonnet-5-5"; // about ten times the price

before(async () => {
  ({ db } = await import("../src/lib/db"));
  R = await import("../src/lib/llm/route");
  const user = await db.user.create({ data: { account: "0x" + "5".repeat(40), handle: "router" } });
  userId = user.id;
  token = "sbh_" + randomBytes(24).toString("base64url");
  await db.apiToken.create({ data: { userId, name: "device: test", prefix: token.slice(0, 10), tokenHash: createHash("sha256").update(token).digest("hex"), scopes: "llm" } });
});

beforeEach(async () => {
  await db.benchEval.deleteMany();
  await db.routeStat.deleteMany();
  await db.usageLedger.deleteMany();
});

async function evalRow(model: string, fair: number, skill = "frontend-design", seconds = 60) {
  await db.benchEval.create({
    data: {
      publisherId: userId, kind: "skill", subject: skill, title: skill, suite: "s", suiteHash: "h" + Math.random(), thinkingModel: model,
      executionModel: model, judgeModel: "google/gemini-pro-latest", testedAt: new Date(), trials: 9, data: {}, meanScore: fair, stdErr: 2,
      fairScore: fair, qualified: 8, critFails: 0, medianSeconds: seconds, costPerPass: 0.05,
    },
  });
}

test("the preference decides between quality, cost and speed; the price is the prior without evaluations", async () => {
  const pick = async (preference: string) => (await R.route({ preference: preference as never, candidates: [LUNA, SONNET] })).model;
  assert.equal(await pick("cost"), LUNA);
  assert.equal(await pick("quality"), SONNET);
  const r = await R.route({ preference: "balanced" });
  assert.ok(r.ranking.length >= 2 && r.ttl > 0 && r.reason);
  assert.ok(r.ranking.every((x) => x.qualitySource === "price"));
});

test("a skill's evaluations beat the price prior, and the reason says so", async () => {
  await evalRow(LUNA, 92);
  await evalRow(SONNET, 55);
  const r = await R.route({ preference: "balanced", skill: "frontend-design", candidates: [LUNA, SONNET] });
  assert.equal(r.model, LUNA);
  assert.equal(r.reason, "此技能評鑑成績最佳");
  assert.equal(r.ranking[0].qualitySource, "skill");
  // another skill: the model's evaluations overall
  const other = await R.route({ preference: "quality", skill: "anatomy", candidates: [LUNA, SONNET] });
  assert.equal(other.ranking.find((x) => x.model === LUNA)!.qualitySource, "evaluations");
});

test("a vendor failing at the relay is left out; thinking leans to quality", async () => {
  const now = Date.now();
  for (let i = 0; i < 5; i++)
    await db.usageLedger.create({ data: { userId, modelId: LUNA, endpoint: "chat", status: "REFUNDED", priceTwd: {}, error: "upstream 503", createdAt: new Date(now - 60_000), settledAt: new Date(now - 59_000) } });
  const r = await R.route({ preference: "cost", candidates: [LUNA, SONNET] });
  assert.equal(r.model, SONNET, "the failing model is out");
  assert.ok(!r.ranking.some((x) => x.model === LUNA));
  await db.usageLedger.deleteMany();
  const main = await R.rank({ preference: "balanced", role: "main", candidates: [LUNA, SONNET] });
  const think = await R.rank({ preference: "balanced", role: "thinking", candidates: [LUNA, SONNET] });
  assert.ok(think.weights.q > main.weights.q);
});

test("P5: reported outcomes are stored without the user and lower a model that often fails", async () => {
  await evalRow(LUNA, 80);
  await evalRow(SONNET, 80);
  const before = await R.route({ preference: "balanced", task_kind: "page", candidates: [LUNA, SONNET] });
  const items = Array.from({ length: 12 }, () => ({ model: "sinobee/" + before.model, task_kind: "page", skill: "my-private-skill", outcome: "failed", seconds: 30, tokens_in: 1000, tokens_out: 200 }));
  assert.deepEqual(await R.recordStats(items), { stored: 12 });
  const row = await db.routeStat.findFirstOrThrow();
  assert.equal(row.skill, null, "a private skill name is not kept");
  assert.equal(row.modelId, before.model);
  assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!("userId" in row));
  const after = await R.rank({ preference: "balanced", task_kind: "page", candidates: [LUNA, SONNET] });
  const hit = after.ranked.find((x) => x.model === before.model)!;
  assert.equal(hit.completion, 0);
  assert.ok(hit.quality < 80 * 0.71);
  await assert.rejects(R.recordStats(Array.from({ length: 51 }, () => items[0])), /at most 50/);
});

test("the settings board: each model with the preferences that would pick it", async () => {
  const rows = await R.boardFor([LUNA, SONNET]);
  assert.equal(rows.length, 2);
  const all = rows.flatMap((r) => r.picks).sort();
  assert.deepEqual(all, ["balanced", "cost", "quality", "speed"].sort());
});

test("the endpoints: route and stats need the device token; the board is public", async () => {
  const route = await import("../src/app/api/v1/llm/route/route");
  const stats = await import("../src/app/api/v1/llm/stats/route");
  const board = await import("../src/app/api/v1/llm/board/route");
  const anon = await route.POST(new Request("http://x/api/v1/llm/route", { method: "POST", body: "{}" }));
  assert.equal(anon.status, 401);
  const ok = await route.POST(new Request("http://x/api/v1/llm/route", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ preference: "cost", role: "main" }) }));
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).model);
  assert.equal((await db.routeStat.count()), 0, "asking stores nothing");
  const st = await stats.POST(new Request("http://x/api/v1/llm/stats", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ items: [{ model: LUNA, outcome: "done", task_kind: "chat" }] }) }));
  assert.deepEqual(await st.json(), { stored: 1 });
  const b = await board.GET(new Request(`http://x/api/v1/llm/board?models=${LUNA},${SONNET}`));
  assert.equal((await b.json()).models.length, 2);
});

test("quality floor: a complex task never gets the cheap-and-fast tier for its main or thinking role, cost preference included", async () => {
  const HAIKU = "anthropic/claude-haiku-5-5";
  for (const task_kind of ["page", "code"]) {
    const r = await R.route({ preference: "cost", task_kind, candidates: [LUNA, HAIKU, SONNET] });
    assert.equal(r.model, SONNET, task_kind);
    assert.ok(r.floor && /複雜任務/.test(r.reason));
    assert.ok(r.ranking.every((x) => x.model !== LUNA && x.model !== HAIKU));
  }
  const thinking = await R.route({ role: "thinking", preference: "cost", complex: true, task_kind: "research", candidates: [LUNA, SONNET] });
  assert.equal(thinking.model, SONNET, "SinoBee may mark any task complex");
  // the cheap tier stays for simple work and for summaries of complex work
  assert.equal((await R.route({ preference: "cost", task_kind: "chat", candidates: [LUNA, SONNET] })).model, LUNA);
  assert.equal((await R.route({ role: "summary", preference: "cost", task_kind: "page", candidates: [LUNA, SONNET] })).model, LUNA);
  // only cheap models left: they are used rather than nothing
  const only = await R.route({ preference: "quality", task_kind: "page", candidates: [LUNA, HAIKU] });
  assert.ok([LUNA, HAIKU].includes(only.model) && !only.floor);
  assert.ok(R.CHEAP_FAST.test("gemini-flash-lite-latest") && R.CHEAP_FAST.test("gpt-5-mini") && !R.CHEAP_FAST.test("gemini-3.1-pro") && !R.CHEAP_FAST.test("gemini-3.8-flash"));
});
