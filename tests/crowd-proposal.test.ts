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
// the spec model runs on the development stand-in (no model keys)
delete process.env.ANTHROPIC_API_KEY;

let db: typeof import("../src/lib/db").db;
let pay: typeof import("../src/lib/payments");
let proposal: typeof import("../src/lib/crowd/proposal");
let spec: typeof import("../src/lib/crowd/spec-agent");
let cards: typeof import("../src/lib/crowd/cards");
let ann: Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;
const buyer = { name: "王小明", email: "ming@example.com" };
const MODEL = "anthropic/claude-sonnet-5-5";

before(async () => {
  await oen.start();
  process.env.OEN_API_BASE = oen.url;
  ({ db } = await import("../src/lib/db"));
  pay = await import("../src/lib/payments");
  proposal = await import("../src/lib/crowd/proposal");
  spec = await import("../src/lib/crowd/spec-agent");
  cards = await import("../src/lib/crowd/cards");
  ann = await db.user.create({ data: { account: "0x" + "a".repeat(40), handle: "ann" } });
});
after(() => oen.stop());

async function paidDraft(input: Parameters<typeof proposal.createDraft>[1]) {
  const t = await proposal.createDraft(ann.id, input);
  await proposal.buyProposalFee(ann.id, t.id, buyer, await anyCard(ann.id));
  return t;
}

test("one description is enough: the model drafts title, category, spec and estimate after the fee is paid", async () => {
  const description = "整理台北市所有公車站的無障礙設施，做成分區報表與改善建議。\n資料來源用政府開放資料。";
  const t = await proposal.createDraft(ann.id, { description, model: MODEL });
  assert.equal(t.title, "整理台北市所有公車站的無障礙設施，做成分區報表與改善建議。", "placeholder title from the first line");
  assert.equal(t.category, null);
  await assert.rejects(spec.generateSpec(ann.id, t.id), /pay the proposal fee/);

  await proposal.buyProposalFee(ann.id, t.id, buyer, await anyCard(ann.id));

  const g = await spec.generateSpec(ann.id, t.id);
  assert.equal(g.generated, true);
  assert.ok(g.costTwd! > 0, "charged to the proposal credit");
  const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.title, "（模擬）公開資料整理報告", "the model named it");
  assert.equal(row.category, "data", "the model classified it");
  const s = row.spec as { estimate: { p90Twd: number }; deliverables: string[] };
  assert.equal(s.estimate.p90Twd, 540, "the model estimated the cost");
  assert.ok(s.deliverables.length > 0);
  assert.equal((row.specChat as { role: string }[]).length, 1, "only the model's note is shown");
  assert.equal(row.evalMethod, null, "a task proposal has no evaluation fields");

  // a second call does nothing (no second charge)
  const used = Number(row.proposalUsedTwd);
  assert.equal((await spec.generateSpec(ann.id, t.id)).generated, false);
  assert.equal(Number((await db.task.findUniqueOrThrow({ where: { id: t.id } })).proposalUsedTwd), used);

  // a title the proposer typed is never replaced by the model
  await proposal.updateDraft(ann.id, t.id, { title: "公車站無障礙調查" });
  await spec.specTurn(ann.id, t.id, "交付物加上英文摘要");
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: t.id } })).title, "公車站無障礙調查");
});

test("line edits keep the model's estimate and stretch goals (they set the goal)", async () => {
  const t = await paidDraft({ description: "Compare bus fares across Asian capitals", model: MODEL });
  await spec.generateSpec(ann.id, t.id);
  const saved = await proposal.saveSpec(ann.id, t.id, { summary: "edited", deliverables: ["report.md"], method: ["collect"], acceptance: ["covers every city"], estimate: { p50Twd: 1, p90Twd: 1 }, stretch: [] });
  assert.equal(saved.summary, "edited");
  assert.equal(saved.estimate.p90Twd, 540, "a hand-typed estimate is ignored");
  assert.equal(saved.stretch?.length, 1);
  // the goal follows the estimate: 540 / (1 − 0) → 540, in whole shares
  const opened = await proposal.openFunding(ann.id, t.id, { durationDays: 7, startEarly: false });
  assert.equal(opened.goalTwd, 540);
  assert.equal(opened.status, "SCREENING");
});

test("evaluations are proposed the same way; the model picks the method and criteria when left open", async () => {
  const t = await paidDraft({ description: "評鑑這個模型在繁體中文摘要上的表現", model: MODEL, kind: "EVALUATION" });
  assert.equal(t.kind, "EVALUATION");
  assert.equal(t.evalMethod, null);
  assert.equal(t.crowdfund, true);
  assert.equal(t.isPublic, true);
  await spec.generateSpec(ann.id, t.id);
  const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.evalMethod, "rubric");
  assert.match(row.evalCriteria ?? "", /正確性/);
  // a method chosen by the proposer stays
  const chosen = await paidDraft({ description: "A/B test two prompts for the summary skill", model: MODEL, kind: "EVALUATION", evalMethod: "a-b-comparison" });
  assert.equal(chosen.evalMethod, "a-b-comparison");
  // without a method the evaluation cannot open
  const open = await paidDraft({ description: "Evaluate the model on maths word problems", model: MODEL, kind: "EVALUATION" });
  await proposal.saveSpec(ann.id, open.id, { summary: "s", deliverables: ["outputs/evaluation.json"], method: ["run cases"], acceptance: ["every case scored"], estimate: { p50Twd: 100, p90Twd: 200 } });
  await assert.rejects(proposal.openFunding(ann.id, open.id, { durationDays: 7, startEarly: false }), /evaluation method/);
});

test("commissioned tasks are gone: no budget or top-up payments", async () => {
  const purposes = Object.keys((await import("../src/generated/sqlite/enums")).PaymentPurpose ?? {});
  assert.ok(!purposes.includes("TASK_BUDGET") && !purposes.includes("TASK_TOPUP"), purposes.join(","));
  const t = await db.task.create({ data: { userId: ann.id, title: "x", prompt: "y", model: MODEL } });
  assert.equal(t.status, "DRAFT");
  assert.equal(t.crowdfund, true);
});

/** A saved card of the user (bound through the stub Oen when there is none): every payment charges one */
async function anyCard(userId: string) {
  const have = await db.savedCard.findFirst({ where: { userId, status: "active" } });
  if (have) return have.id;
  const b = await cards.startBinding(userId, { returnTo: "/account" });
  const card = await db.savedCard.findUniqueOrThrow({ where: { id: b.id } });
  await pay.handleWebhook(oen.bindCard(card.bindingId));
  return card.id;
}

test("the platform model follows the admin settings and the keys that are set, never a fixed vendor", async () => {
  const { platformModel, usableModels } = await import("../src/lib/platform-model");
  const keep = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY, m: process.env.CROWD_SPEC_MODEL };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    assert.equal(await platformModel(), null, "no key at all");
    process.env.OPENAI_API_KEY = "sk-test";
    const usable = await usableModels();
    assert.ok(usable.length > 0 && usable.every((u) => u.provider === "openai"), "only providers with a key");
    process.env.CROWD_SPEC_MODEL = "anthropic/claude-sonnet-5-5";
    assert.equal((await platformModel())!.provider, "openai", "the chosen model has no key: the first usable one");
    const second = usable[usable.length - 1].model.modelId;
    process.env.CROWD_SPEC_MODEL = second;
    assert.equal((await platformModel())!.model.modelId, second, "the admin's choice when it has a key");
  } finally {
    for (const [k, v] of [["ANTHROPIC_API_KEY", keep.a], ["OPENAI_API_KEY", keep.o], ["CROWD_SPEC_MODEL", keep.m]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("drafting runs in the background (no long request for a proxy to cut off); the page polls the progress", async () => {
  const t = await paidDraft({ description: "Map every public drinking fountain in Taipei", model: MODEL });
  const other = await db.user.create({ data: { account: "0x" + "e".repeat(40), handle: "eve" } });
  await assert.rejects(spec.specProgress(other.id, t.id), /not found/, "only the proposer sees the progress");
  process.env.SPEC_MOCK_DELAY_MS = "300";
  assert.deepEqual(await spec.startGenerate(ann.id, t.id), { state: "running" });
  assert.equal((await spec.specProgress(ann.id, t.id)).state, "running");
  await assert.rejects(spec.startTurn(ann.id, t.id, "more detail"), /still working/, "one job at a time");
  assert.deepEqual(await spec.startGenerate(ann.id, t.id), { state: "running" }, "a second start joins the running job");
  await new Promise((r) => setTimeout(r, 100));
  delete process.env.SPEC_MOCK_DELAY_MS;
  let p = await spec.specProgress(ann.id, t.id);
  for (let i = 0; i < 100 && !p.hasSpec; i++) {
    await new Promise((r) => setTimeout(r, 20));
    p = await spec.specProgress(ann.id, t.id);
  }
  assert.equal(p.hasSpec, true);
  assert.equal(p.state, "idle");
  assert.deepEqual(await spec.startGenerate(ann.id, t.id), { state: "done" });

  // a dialogue turn the same way
  assert.deepEqual(await spec.startTurn(ann.id, t.id, "加上英文摘要"), { state: "running" });
  for (let i = 0; i < 100 && (await spec.specProgress(ann.id, t.id)).state === "running"; i++) await new Promise((r) => setTimeout(r, 20));
  p = await spec.specProgress(ann.id, t.id);
  assert.equal(p.state, "idle");
  assert.equal(p.chatLength, 3, "the model's note, the question and the reply");

  // a failure is reported to the page, not swallowed
  const keep = process.env.NODE_ENV;
  const noModel = await paidDraft({ description: "Survey night markets", model: MODEL });
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    await spec.startGenerate(ann.id, noModel.id);
    for (let i = 0; i < 100 && (await spec.specProgress(ann.id, noModel.id)).state === "running"; i++) await new Promise((r) => setTimeout(r, 20));
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = keep;
  }
  const failed = await spec.specProgress(ann.id, noModel.id);
  assert.equal(failed.state, "error");
  assert.ok(failed.error && failed.error.length > 0, failed.error);
  assert.equal(failed.hasSpec, false);
});

test("a model ID the provider does not know (404) falls through to the next usable model; the real error is shown", async () => {
  const http = await import("node:http");
  const seen: string[] = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const model = JSON.parse(body).model as string;
      seen.push(`${req.url} ${model}`);
      res.setHeader("content-type", "application/json");
      if (req.url!.startsWith("/gemini")) {
        res.statusCode = 404; // Gemini's OpenAI endpoint wraps the error in an array
        return res.end(JSON.stringify([{ error: { code: 404, message: `models/${model} is not found for API version v1main`, status: "NOT_FOUND" } }]));
      }
      if (req.url!.startsWith("/down")) {
        res.statusCode = 502;
        return res.end("<html><body>Bad gateway</body></html>");
      }
      res.end(JSON.stringify({ choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const env = ["GEMINI_API_KEY", "LLM_BASE_GEMINI", "OPENAI_API_KEY", "LLM_BASE_OPENAI", "CROWD_SPEC_MODEL", "ANTHROPIC_API_KEY"] as const;
  const keep = Object.fromEntries(env.map((k) => [k, process.env[k]]));
  const { platformChat } = await import("../src/lib/platform-model");
  try {
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, { GEMINI_API_KEY: "g", LLM_BASE_GEMINI: `${base}/gemini`, OPENAI_API_KEY: "o", LLM_BASE_OPENAI: `${base}/openai`, CROWD_SPEC_MODEL: "gemini/gemini-3.1-pro" });
    const r = await platformChat({ system: "s", messages: [{ role: "user", content: "ping" }], maxTokens: 100 });
    assert.equal(r.text, "pong");
    assert.equal(r.model.modelId.split("/")[0], "openai");
    assert.equal(seen[0], "/gemini/chat/completions gemini-3.1-pro", "the admin's choice was tried first");
    seen.length = 0;
    await platformChat({ system: "s", messages: [{ role: "user", content: "ping" }], maxTokens: 100 });
    assert.ok(seen[0].startsWith("/openai"), "a model that just failed is tried last for a while");

    // every model fails: the error names each model and the provider's own message
    process.env.LLM_BASE_OPENAI = `${base}/down`;
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(platformChat({ system: "s", messages: [{ role: "user", content: "ping" }], maxTokens: 100 }), (e: Error & { status?: number }) => {
      assert.match(e.message, /openai\/gpt-[^:]+: 502 Bad gateway/);
      return true;
    });
    process.env.GEMINI_API_KEY = "g";
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(platformChat({ system: "s", messages: [{ role: "user", content: "ping" }], maxTokens: 100 }), /gemini\/gemini-3\.1-pro: 404 models\/gemini-3\.1-pro is not found/);
  } finally {
    srv.close();
    for (const k of env) {
      if (keep[k] === undefined) delete process.env[k];
      else process.env[k] = keep[k];
    }
  }
});
