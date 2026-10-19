import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { useTestDb } from "./helpers/testdb";
import { COMBOS, payload } from "./helpers/bench-fixture";

useTestDb();
let db: typeof import("../src/lib/db").db;
let B: typeof import("../src/lib/bench-evals");
let route: typeof import("../src/app/api/v1/evals/route");
let one: typeof import("../src/app/api/v1/evals/[id]/route");
let userId = "";

async function token(scopes: string) {
  const t = "sbh_" + randomBytes(24).toString("base64url");
  await db.apiToken.create({ data: { userId, name: "device: test", prefix: t.slice(0, 10), tokenHash: createHash("sha256").update(t).digest("hex"), scopes } });
  return t;
}
const post = (body: unknown, tok?: string) =>
  new Request("http://localhost/api/v1/evals", { method: "POST", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });

before(async () => {
  ({ db } = await import("../src/lib/db"));
  B = await import("../src/lib/bench-evals");
  route = await import("../src/app/api/v1/evals/route");
  one = await import("../src/app/api/v1/evals/[id]/route");
  userId = (await db.user.create({ data: { account: "0x" + "6".repeat(40), handle: "bee" } })).id;
});

test("SFS: category weights, the critical cap, qualification and the fair score", () => {
  const t = { questions: [
    { label: "a", category: "A", kind: "det" as const, critical: true, owner: "execution" as const, stage: "output" as const },
    { label: "b", category: "A", kind: "det" as const, critical: false, owner: "execution" as const, stage: "output" as const },
    { label: "c", category: "B", kind: "judge" as const, critical: false, owner: "thinking" as const, stage: "plan" as const },
  ], weights: { A: 30, B: 10 } };
  assert.deepEqual(B.trialScore(t, [true, false, true]), { q: 62.5, critFail: false, qualified: false });
  assert.deepEqual(B.trialScore(t, [false, true, true]), { q: 40, critFail: true, qualified: false });
  assert.equal(B.trialScore({ ...t, weights: {} }, [true, false, false]).q, 25);
  const f = B.fair([81.75, 88.75, 85.75]);
  assert.equal(f.mean.toFixed(2), "85.42");
  assert.equal(f.se.toFixed(2), "2.03");
  assert.equal(f.fair.toFixed(2), "83.39");
  assert.deepEqual(B.fair([90]), { n: 1, mean: 90, se: 0, fair: 90 });
});

test("a report's numbers are recomputed from the answers, not taken from the client", () => {
  const s = B.reportStats(B.evalInput.parse(payload(COMBOS.opusFlash)));
  assert.deepEqual(s.trialQ, [81.75, 88.75, 85.75]);
  assert.equal(s.qualified, 3);
  assert.equal(s.medianSeconds, 214);
  assert.equal(s.p90Seconds, 221);
  assert.equal(s.costPerPass!.toFixed(2), "0.71");
  const g = B.reportStats(B.evalInput.parse(payload(COMBOS.proGemma)));
  assert.equal(g.critFails, 3);
  assert.ok(g.trialQ.every((q) => q <= 40));
  assert.equal(g.costPerPass, null);
  assert.equal(B.verdict(g.mean, g.critFails, g.observations), "failed");
  assert.equal(B.verdict(85, 0, 3), "done");
  assert.equal(B.verdict(85, 1, 3), "partial");
  assert.equal(B.family("gemini/gemini-pro-latest"), "gemini");
  assert.ok(B.sameFamily("gemini/gemini-pro-latest", "anthropic/claude-opus-5-5", "gemini/gemini-flash-latest"));
  assert.ok(!B.sameFamily("gemini/gemini-pro-latest", "anthropic/claude-opus-5-5", "anthropic/claude-sonnet-4-5"));
});

test("SinoBee publishes one combination per report with evals:write; refusals", async () => {
  assert.equal((await route.POST(post(payload(COMBOS.opusFlash)))).status, 401);
  assert.equal((await route.POST(post(payload(COMBOS.opusFlash), await token("llm")))).status, 403);
  const tok = await token("llm evals:write");
  const r = await route.POST(post(payload(COMBOS.opusFlash, { creativity: null }), tok));
  assert.equal(r.status, 201);
  const { id, url } = await r.json();
  assert.match(url, /\/benchmarks\/evals\/\d+$/);
  const row = await db.benchEval.findUniqueOrThrow({ where: { id } });
  assert.equal(row.thinkingModel, "anthropic/claude-opus-5-5");
  assert.equal(row.executionModel, "gemini/gemini-flash-latest");
  assert.equal(row.trials, 3);
  assert.equal(row.fairScore.toFixed(2), "83.39");
  assert.equal(row.testedAt.getTime(), 1792500000 * 1000);
  // a model evaluation names one model; a trial answers every question; tasks have the same number of trials
  assert.equal((await route.POST(post(payload(COMBOS.opusFlash, { kind: "model" }), tok))).status, 400);
  const short = payload(COMBOS.opusFlash);
  short.tasks[0].trials[0].grades.pop();
  assert.equal((await route.POST(post(short, tok))).status, 400);
  assert.equal((await route.POST(post({ ...payload(COMBOS.opusFlash), tasks: [] }, tok))).status, 400);
  const list = await (await route.GET(new Request("http://localhost/api/v1/evals?kind=skill&subject=youtube-analysis"))).json();
  assert.equal(list.items.length, 1);
  assert.equal((await (await route.GET(new Request("http://localhost/api/v1/evals?kind=model"))).json()).items.length, 0);
  const full = await (await one.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: String(id) }) })).json();
  assert.equal(full.data.tasks[0].questions.length, 17);
  assert.equal(full.publisherId, undefined);
  assert.equal((await one.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "nope" }) })).status, 404);
});

test("the four answers: who is fastest, cheapest, best and most creative, with ties, balance and value", () => {
  const rows = Object.entries(COMBOS).map(([k, c], i) => {
    const p = B.evalInput.parse(payload(c));
    const s = B.reportStats(p);
    return { key: k, id: i + 1, kind: "skill", thinkingModel: c.thinking, executionModel: c.execution, trials: s.n, meanScore: s.mean, stdErr: s.se,
      fairScore: s.fair, qualified: s.qualified, critFails: s.critFails, medianSeconds: s.medianSeconds, p90Seconds: s.p90Seconds, costPerPass: s.costPerPass,
      creativityWins: p.creativity?.wins ?? null, creativityTotal: p.creativity?.total ?? null, testedAt: new Date(), observations: s.observations };
  });
  const b = B.board(rows);
  const name = (c: { id: number } | null) => rows.find((r) => r.id === c?.id)?.key;
  assert.deepEqual(b.contenders.filter((c) => c.out).map((c) => [name(c), c.out]), [["proGemma", "critical"], ["sonnetHaiku", "trial"]]);
  const [speed, cost, quality, crea] = b.awards;
  assert.equal(name(speed.winner), "flashFlash");
  assert.equal(name(cost.winner), "flashFlash");
  assert.equal(name(quality.winner), "opusSonnet");
  assert.equal(quality.tied.length, 0);
  assert.equal(name(crea.winner), "opusSonnet");
  assert.deepEqual(crea.tied.map(name), ["opusFlash"]);           // 77% vs 69% of 48 comparisons: within the noise
  assert.equal(name(b.balanced), "opusFlash");
  assert.equal(name(b.value), "proPro");                          // within 5 points of the best, the cheapest
});

test("comparable reports: the newest suite version and judge, the newest report per combination", () => {
  const r = (id: number, h: string, th: string, t: number) => ({ id, suiteHash: h, judgeModel: "j", thinkingModel: th, executionModel: "e", testedAt: new Date(t) });
  const { set, other } = B.comparable([r(1, "h1", "a", 1), r(2, "h2", "a", 2), r(3, "h2", "b", 3), r(4, "h2", "a", 4)]);
  assert.deepEqual(set.map((x) => x.id), [4, 3]);
  assert.deepEqual(other.map((x) => x.id), [2, 1]);
});
