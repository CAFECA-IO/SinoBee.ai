import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { useTestDb } from "./helpers/testdb";

useTestDb();
let db: typeof import("../src/lib/db").db;
let ev: typeof import("../src/lib/evaluations");
let route: typeof import("../src/app/api/v1/evaluations/route");
let userId = "";

async function token(scopes: string) {
  const t = "sbh_" + randomBytes(24).toString("base64url");
  await db.apiToken.create({ data: { userId, name: "device: test", prefix: t.slice(0, 10), tokenHash: createHash("sha256").update(t).digest("hex"), scopes } });
  return t;
}
const trial = (passed: boolean, ok: boolean[], duration: number, inTok: number, outTok: number) => ({
  trial: 1, passed, status: passed ? "done" : "incomplete", steps: 12, duration_s: duration, input_tokens: inTok, output_tokens: outTok,
  grades: ok.map((o, i) => ({ label: ["全部單元測試通過", "沒有修改既有測試", "修正品質（評鑑模型）"][i], ok: o, detail: o ? "exit 0" : "exit 1" })),
});
const run = (model: string, ok: boolean[], duration: number) => ({
  model, solo: true, totals: { score: 0 }, judge_usage: { calls: 1, input_tokens: 3000, output_tokens: 100 },
  tasks: [{ id: "coding-ledger", title: "修好記帳套件", prompt: "…", graders: ["全部單元測試通過", "沒有修改既有測試", "修正品質（評鑑模型）"],
    trials: [trial(ok.every(Boolean), ok, duration, 200_000, 9_000)] }],
});
const study = (o: Record<string, unknown> = {}) => ({
  kind: "model", title: "模型評鑑：程式修改與除錯", domain: "程式修改與除錯", summary: "s", body: "# 分析\n\npro 較好",
  suite: "bench-coding", judge: "gemini/gemini-pro-latest", client_version: "0.9.0", tested_at: 1792500000, tested_until: 1792503600,
  runs: [run("gemini/gemini-flash-latest", [true, true, false], 300), run("gemini/gemini-pro-latest", [true, true, true], 900), run("ollama/gemma4:e4b", [false, true, false], 1200)],
  ...o,
});
const post = (body: unknown, tok?: string) =>
  new Request("http://localhost/api/v1/evaluations", { method: "POST", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });

before(async () => {
  ({ db } = await import("../src/lib/db"));
  ev = await import("../src/lib/evaluations");
  route = await import("../src/app/api/v1/evaluations/route");
  userId = (await db.user.create({ data: { account: "0x" + "5".repeat(40), handle: "bee" } })).id;
});

test("stats come from the trials, not the client's totals", () => {
  const s = ev.runStats(study().runs[0] as never);
  assert.equal(s.score, 66.7);
  assert.equal(s.trialPass, 0);
  assert.equal(s.durationS, 300);
  assert.equal(s.inputTokens + s.outputTokens, 209_000);
});

test("SinoBee publishes a study with evals:write; it ranks the models and lists publicly", async () => {
  const r = await route.POST(post(study(), await token("llm evals:write")));
  assert.equal(r.status, 201);
  const { id, url } = await r.json();
  assert.match(url, /\/benchmarks\/studies\//);
  const row = await db.evaluationStudy.findUniqueOrThrow({ where: { id } });
  assert.equal(row.bestModel, "gemini/gemini-pro-latest");
  assert.equal(row.bestScore, 100);
  assert.equal(row.judgeModel, "gemini/gemini-pro-latest");
  assert.equal(row.testedAt.getTime(), 1792500000 * 1000);
  assert.equal(row.models, "gemini/gemini-flash-latest,gemini/gemini-pro-latest,ollama/gemma4:e4b");
  const list = await (await route.GET(new Request("http://localhost/api/v1/evaluations?kind=model"))).json();
  assert.equal(list.items[0].id, id);
  assert.deepEqual(list.items[0].models.length, 3);
  assert.equal((await (await route.GET(new Request("http://localhost/api/v1/evaluations?kind=skill"))).json()).items.length, 0);
});

test("refused: no token scope, a skill study without its skill, the same model twice, bad shapes", async () => {
  assert.equal((await route.POST(post(study(), await token("llm")))).status, 403);
  assert.equal((await route.POST(post(study()))).status, 401);
  const tok = await token("evals:write");
  assert.equal((await route.POST(post(study({ kind: "skill" }), tok))).status, 400);
  const twice = study();
  (twice.runs as unknown[]).push(run("gemini/gemini-pro-latest", [true, true, true], 1));
  assert.equal((await route.POST(post(twice, tok))).status, 400);
  assert.equal((await route.POST(post(study({ runs: [] }), tok))).status, 400);
  assert.equal((await route.POST(post(study({ kind: "skill", skill: "youtube-analysis" }), tok))).status, 201);
});
