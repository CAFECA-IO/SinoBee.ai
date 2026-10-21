import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { useTestDb } from "./helpers/testdb";
import { StubLlm } from "./helpers/stub-llm";

useTestDb();
process.env.OPENAI_API_KEY = "sk-test-openai";
process.env.ANTHROPIC_API_KEY = "sk-test-anthropic";
process.env.LLM_RPM = "1000";
const llm = new StubLlm();

let db: typeof import("../src/lib/db").db;
let relay: typeof import("../src/lib/llm/relay");
let quota: typeof import("../src/lib/llm/quota");
let plans: typeof import("../src/lib/plans");
let config: typeof import("../src/lib/config").config;
let token = "";
let userId = "";
let subId = "";

const LUNA = "openai/gpt-5.6-luna"; // 7.02 in / 42.12 out TWD per 1M
const SONNET = "anthropic/claude-sonnet-5-5"; // 70.2 in / 3.51 cache read / 87.75 cache write / 351 out

before(async () => {
  await llm.start();
  ({ db } = await import("../src/lib/db"));
  ({ config } = await import("../src/lib/config"));
  process.env.LLM_BASE_OPENAI = llm.url;
  process.env.LLM_BASE_ANTHROPIC = llm.url;
  relay = await import("../src/lib/llm/relay");
  quota = await import("../src/lib/llm/quota");
  plans = await import("../src/lib/plans");
  const user = await db.user.create({ data: { account: "0x" + "4".repeat(40), handle: "bee" } });
  userId = user.id;
  token = "sbh_" + randomBytes(24).toString("base64url");
  await db.apiToken.create({ data: { userId, name: "device: test", prefix: token.slice(0, 10), tokenHash: createHash("sha256").update(token).digest("hex"), scopes: "llm skills:publish" } });
});
after(() => llm.stop());

/** a plan whose max usage is fee ÷ `div` (usage multiplier 1/div); L168 = fee / div / 4.8, L6 = L168 / 10 */
async function subscribe(fee: number, div = 3, concurrency = 2) {
  const admin = await db.user.upsert({ where: { account: "0x" + "a".repeat(40) }, create: { account: "0x" + "a".repeat(40), role: "ADMIN", isAdmin: true }, update: {} });
  const code = `t${fee}-${concurrency}`;
  const existing = (await plans.listPlans()).find((p) => p.code === code);
  const plan = await plans.savePlan(admin.id, { id: existing?.id, code, name: code, nameEn: code, feeTwd: fee, multiplier: 1 / div, concurrency, active: true });
  await db.subscription.deleteMany({ where: { userId } });
  await db.payment.deleteMany({ where: { userId } });
  const pay = await db.payment.create({ data: { userId, purpose: "SUBSCRIPTION", provider: "MOCK", amount: fee, amountTwd: fee, amountBase: String(fee), token: "TWD", recipient: "mock", status: "CONFIRMED", planId: plan.id } });
  const sub = await db.subscription.create({ data: { userId, plan: plan.code, planId: plan.id, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 30 * 86400_000), paymentId: pay.id } });
  subId = sub.id;
  return plan;
}

beforeEach(async () => {
  llm.next = StubLlm.defaults();
  llm.requests = [];
  quota.resetRpm();
  await db.usageLedger.deleteMany();
  await db.userModelStats.deleteMany();
});

const post = (path: string, body: object, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });

async function readAll(r: Response) {
  return await r.text();
}
const rows = () => db.usageLedger.findMany({ orderBy: { createdAt: "asc" } });

test("without a subscription the free plan applies (1/20 of Pro, managed by admins); switched off, a subscription is required", async () => {
  await db.subscription.deleteMany({ where: { userId } });
  const free = (await plans.freePlan())!;
  const pro = (await plans.listPlans()).find((p) => p.code === "low")!;
  assert.equal(free.feeTwd, 0);
  assert.equal(free.maxCostTwd, Math.round((pro.maxCostTwd / 20) * 100) / 100, "1/20 of Pro");
  assert.ok(!(await plans.listPlans({ activeOnly: true })).some((p) => p.code === "free"), "not a plan to buy");
  const ctx = await quota.quotaContext(userId);
  assert.deepEqual([ctx.subscriptionId, ctx.plan.code, ctx.plan.l168Twd], [null, "free", Math.round((free.maxCostTwd / 4.8) * 100) / 100]);
  llm.next.chunks = 1;
  const freeCall = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "hi" }] }), "openai", "chat");
  assert.equal(freeCall.status, 200);
  assert.equal((await rows()).at(-1)?.subscriptionId, null);

  const admin = await db.user.upsert({ where: { account: "0x" + "a".repeat(40) }, create: { account: "0x" + "a".repeat(40), role: "ADMIN", isAdmin: true }, update: {} });
  const edited = await plans.saveFreePlan(admin.id, { name: "免費", nameEn: "Free", maxCostTwd: 48, concurrency: 1, active: true });
  assert.deepEqual([edited.maxCostTwd, edited.l168Twd, edited.l6Twd], [48, 10, 1]);
  await assert.rejects(plans.savePlan(admin.id, { code: "free", name: "x", nameEn: "x", feeTwd: 1, multiplier: 1, concurrency: 1, active: true }), /own form/);
  await plans.saveFreePlan(admin.id, { name: "免費", nameEn: "Free", maxCostTwd: 48, concurrency: 1, active: false });
  const noSub = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "hi" }] }), "openai", "chat");
  assert.equal(noSub.status, 402);
  assert.equal((await noSub.json()).error.type, "subscription_required");
  const anon = await relay.relay(new Request("http://localhost/x", { method: "POST", body: "{}" }), "openai", "chat");
  assert.equal(anon.status, 401);
  // Anthropic SDKs send x-api-key
  await subscribe(840);
  llm.next.chunks = 1;
  const viaKey = await relay.relay(post("/api/v1/llm/anthropic/v1/messages", { model: "claude-sonnet-5.5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }, { authorization: "", "x-api-key": token }), "anthropic", "messages");
  assert.equal(viaKey.status, 200);
  // wrong format for the model
  const wrong = await relay.relay(post("/api/v1/llm/chat/completions", { model: SONNET, messages: [{ role: "user", content: "hi" }] }), "openai", "chat");
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error.message, /anthropic\/v1\/messages/);
});

test("non-streaming: platform key added, params whitelisted, settled from usage at published prices", async () => {
  await subscribe(840);
  llm.next = { ...StubLlm.defaults(), promptTokens: 2000, cacheRead: 1000, chunks: 10 };
  const r = await relay.relay(post("/api/v1/llm/chat/completions", { model: "gpt-5.6-luna", messages: [{ role: "user", content: "summarise" }], max_tokens: 500, logprobs: true, n: 3 }), "openai", "chat");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.choices[0].message.content);
  const sent = llm.requests[0];
  assert.equal(sent.headers.authorization, "Bearer sk-test-openai", "platform key, not the user's token");
  assert.equal(sent.body.model, "gpt-5.6-luna");
  assert.equal(sent.body.max_completion_tokens, 500);
  assert.equal(sent.body.logprobs, undefined, "unknown params dropped");
  assert.equal(sent.body.n, undefined);
  const [row] = await rows();
  assert.equal(row.status, "SETTLED");
  const out = Math.ceil((12 * 10) / 4);
  const expect = ((2000 - 1000) * 7.02 + 1000 * 0.702 + out * 42.12) / 1e6;
  assert.ok(Math.abs(Number(row.settledTwd) - expect) < 1e-6, `${row.settledTwd} vs ${expect}`);
  assert.equal(row.cacheReadTokens, 1000);
  // SinoBee shows this call's share of the 6-hour limit from these headers
  const share = Number(r.headers.get("x-sinobee-cost-6h-pct"));
  assert.ok(share > 0 && share <= 100);
  assert.ok(Number(r.headers.get("x-sinobee-quota-6h")) >= share);
  assert.ok(Number(r.headers.get("x-sinobee-quota-168h")) > 0);
});

test("non-streaming: max_tokens is lowered to what the remaining quota can pay for", async () => {
  // fee 30 / 3 → L6 ≈ 0.21 TWD; Luna output 42.12 TWD per 1M → at most ~4,900 output tokens
  const plan = await subscribe(30);
  await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "x" }], max_tokens: 30000 }), "openai", "chat");
  const asked = Number(llm.requests[0].body.max_completion_tokens);
  assert.ok(asked < 30000 && asked > 3000, `lowered to ${asked}`);
  assert.ok(asked * 42.12 / 1e6 <= plan.l6Twd);
});

test("stream: hold = prompt + average output, 256-token top-ups, settled from usage within 2 s", async () => {
  await subscribe(3675, 1.5);
  llm.next = { ...StubLlm.defaults(), chunks: 400, text: "token token token ", delayMs: 0 };
  const r = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, stream: true, messages: [{ role: "user", content: "write a long story" }] }), "openai", "chat");
  assert.equal(r.headers.get("content-type")?.startsWith("text/event-stream"), true);
  const text = await readAll(r);
  assert.match(text, /\[DONE\]/);
  assert.equal(llm.requests[0].body.stream_options && (llm.requests[0].body.stream_options as { include_usage: boolean }).include_usage, true);
  const [row] = await rows();
  assert.equal(row.status, "SETTLED");
  assert.ok(row.heldOutput > 800, `topped up to ${row.heldOutput}`);
  assert.equal((row.heldOutput - 800) % 256, 0, "in 256-token steps");
  assert.ok(row.settledAt!.getTime() - llm.lastChunkAt < 2000, "reconciled within 2 s of the last upstream event");
  assert.equal(row.outputTokens, Math.ceil((18 * 400) / 4));
  // the average output is learned for the next hold
  const stats = await db.userModelStats.findUniqueOrThrow({ where: { userId_modelId: { userId, modelId: LUNA } } });
  assert.equal(Math.round(stats.avgOutput), row.outputTokens);
});

test("stream: when a top-up no longer fits, the stream ends with finish_reason quota and the windows stay within L6", async () => {
  const plan = await subscribe(30); // L6 ≈ 0.208 TWD
  llm.next = { ...StubLlm.defaults(), chunks: 5000, text: "lorem ipsum dolor sit amet ", delayMs: 1 };
  const r = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, stream: true, messages: [{ role: "user", content: "go on forever" }] }), "openai", "chat");
  const text = await readAll(r);
  assert.match(text, /"finish_reason":"quota"/);
  assert.match(text, /\[DONE\]/);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(llm.aborted, 1, "upstream call stopped");
  const [row] = await rows();
  assert.equal(row.status, "ESTIMATED");
  const u = await quota.windowUse(userId);
  assert.ok(u.w6 <= plan.l6Twd + 1e-9, `${u.w6} ≤ ${plan.l6Twd}`);
  // and the next call is refused with a retry time
  const again = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "more" }] }), "openai", "chat");
  assert.equal(again.status, 429);
  const j = await again.json();
  assert.equal(j.error.code, "6h");
  assert.ok(j.error.retry_at && again.headers.get("retry-after"));
  llm.aborted = 0;
});

test("concurrency: the plan's limit applies and parallel streams never overshoot the window together", async () => {
  const plan = await subscribe(30, 3, 2);
  llm.next = { ...StubLlm.defaults(), chunks: 3000, text: "parallel words here ", delayMs: 1 };
  const go = () => relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, stream: true, messages: [{ role: "user", content: "x" }] }), "openai", "chat");
  const [a, b] = [await go(), await go()];
  const c = await go(); // third while two are held
  assert.equal(c.status, 429);
  assert.equal((await c.json()).error.code, "concurrency");
  await Promise.all([readAll(a), readAll(b)]);
  const u = await quota.windowUse(userId);
  assert.ok(u.w6 <= plan.l6Twd + 1e-9, `${u.w6} ≤ ${plan.l6Twd}`);
  assert.equal(u.held, 0);
});

test("client abort settles what was produced; no usage → estimated; upstream error → refunded", async () => {
  await subscribe(840);
  llm.next = { ...StubLlm.defaults(), chunks: 2000, delayMs: 2 };
  const r = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, stream: true, messages: [{ role: "user", content: "x" }] }), "openai", "chat");
  const reader = r.body!.getReader();
  await reader.read();
  await reader.read();
  await reader.cancel();
  await new Promise((res) => setTimeout(res, 100));
  let [row] = await rows();
  assert.equal(row.status, "ESTIMATED");
  assert.match(row.error ?? "", /client aborted/);
  assert.equal(llm.aborted >= 1, true);

  await db.usageLedger.deleteMany();
  llm.next = { ...StubLlm.defaults(), noUsage: true, chunks: 20 };
  await readAll(await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, stream: true, messages: [{ role: "user", content: "x" }] }), "openai", "chat"));
  [row] = await rows();
  assert.equal(row.status, "ESTIMATED");
  assert.ok(row.outputTokens > 0);

  await db.usageLedger.deleteMany();
  llm.next = { ...StubLlm.defaults(), status: 500 };
  const bad = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "x" }] }), "openai", "chat");
  assert.equal(bad.status, 503);
  [row] = await rows();
  assert.equal(row.status, "REFUNDED");
  assert.equal(Number(row.settledTwd), 0);
});

test("non-streaming: a caller that gives up (proxy timeout) stops the upstream call and is not charged", async () => {
  await subscribe(840);
  llm.next = { ...StubLlm.defaults(), replyDelayMs: 1500 };
  const before = llm.aborted;
  const ac = new AbortController();
  const req = new Request("http://localhost/api/v1/llm/anthropic/v1/messages", { method: "POST", signal: ac.signal, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: SONNET, max_tokens: 2048, messages: [{ role: "user", content: "write the whole page" }] }) });
  setTimeout(() => ac.abort(), 200);
  const r = await relay.relay(req, "anthropic", "messages");
  assert.equal(r.status, 499);
  await new Promise((res) => setTimeout(res, 100));
  const [row] = await rows();
  assert.equal(row.status, "REFUNDED");
  assert.equal(Number(row.settledTwd), 0);
  assert.match(row.error ?? "", /client aborted before the answer arrived/);
  assert.equal(llm.aborted, before + 1, "upstream call stopped");
  // a caller that waits gets the answer and is charged as usual
  await db.usageLedger.deleteMany();
  llm.next = { ...StubLlm.defaults(), replyDelayMs: 50 };
  const ok = await relay.relay(post("/api/v1/llm/anthropic/v1/messages", { model: SONNET, max_tokens: 256, messages: [{ role: "user", content: "hi" }] }, { "anthropic-version": "2023-06-01" }), "anthropic", "messages");
  assert.equal(ok.status, 200);
  assert.equal((await rows())[0].status, "SETTLED");
});

test("Anthropic stream: cache reads and writes are priced separately; prompt = input + cache tokens", async () => {
  await subscribe(3675, 1.5);
  llm.next = { ...StubLlm.defaults(), promptTokens: 10000, cacheRead: 6000, cacheWrite: 2000, chunks: 8, text: "Claude says hi " };
  const r = await relay.relay(post("/api/v1/llm/anthropic/v1/messages", { model: SONNET, stream: true, max_tokens: 1024, system: "be brief. ".repeat(3500), messages: [{ role: "user", content: "hi" }], metadata: { user_id: "x" } }, { "anthropic-version": "2023-06-01" }), "anthropic", "messages");
  const text = await readAll(r);
  assert.match(text, /message_stop/);
  const sent = llm.requests[0];
  assert.equal(sent.headers["x-api-key"], "sk-test-anthropic");
  assert.equal(sent.body.model, "claude-sonnet-5-5");
  assert.equal(sent.body.metadata, undefined);
  const [row] = await rows();
  assert.equal(row.status, "SETTLED");
  assert.equal(row.promptTokens, 10000);
  const out = Math.ceil((15 * 8) / 4);
  const expect = (2000 * 70.2 + 6000 * 3.51 + 2000 * 87.75 + out * 351) / 1e6;
  assert.ok(Math.abs(Number(row.settledTwd) - expect) < 1e-6, `${row.settledTwd} vs ${expect}`);
  // the answer's share of the quota, sent last as an SSE comment (headers left before it was known)
  const q = JSON.parse(/^: x-sinobee-quota (.+)$/m.exec(text)![1]);
  assert.ok(Number(q["x-sinobee-cost-6h-pct"]) > 0 && "x-sinobee-quota-168h" in q);
  assert.ok(text.trimEnd().endsWith("}"), "the comment comes after message_stop");
});

test("windows release 6 h / 168 h after the cost was incurred; stale holds are swept", async () => {
  const plan = await subscribe(840);
  const base = { userId, modelId: LUNA, endpoint: "chat", priceTwd: { input: 7.02, cacheRead: 0.702, cacheWrite: 7.02, output: 42.12 } };
  await db.usageLedger.create({ data: { ...base, status: "SETTLED", settledTwd: 3, heldTwd: 3, settledAt: new Date(Date.now() - 7 * 3600_000) } });
  await db.usageLedger.create({ data: { ...base, status: "SETTLED", settledTwd: 1, heldTwd: 1, settledAt: new Date(Date.now() - 3600_000) } });
  await db.usageLedger.create({ data: { ...base, status: "HELD", heldTwd: 0.5, createdAt: new Date(Date.now() - 11 * 60_000) } });
  let u = await quota.windowUse(userId);
  assert.ok(Math.abs(u.w6 - 1.5) < 1e-9, "the 7-hour-old call left the 6 h window");
  assert.ok(Math.abs(u.w168 - 4.5) < 1e-9);
  const st = await quota.quotaStatus(userId);
  assert.equal(st.windows[0].window, "6h");
  assert.ok(Math.abs(st.windows[0].usedPct - (1.5 / plan.l6Twd) * 100) < 1e-6);
  assert.ok(st.windows[0].remainingTokens > 0);
  // the 6 h timeline: 12 half-hour buckets; the call made 1 hour ago sits at the 5-hour mark (index 9 or 10 by a few
  // ms), the 7-hour-old one is gone
  const b = st.windows[0].buckets!;
  assert.equal(b.length, 12);
  const i = b.findIndex((x) => x > 0);
  assert.ok([9, 10].includes(i) && b.filter((x) => x > 0).length === 1, JSON.stringify(b));
  assert.ok(Math.abs(b[i] - Math.round((1 / plan.l6Twd) * 100 * 100) / 100) < 1e-9);
  assert.equal(st.windows[1].buckets, undefined);
  assert.equal(st.tokensBasis?.model, "anthropic/claude-sonnet-5-5", "token counts use Claude Sonnet 5.5");
  assert.equal(await quota.sweepHolds(), 1);
  u = await quota.windowUse(userId);
  assert.equal(u.held, 0);
  const swept = await db.usageLedger.findFirstOrThrow({ where: { status: "EXPIRED" } });
  assert.equal(Number(swept.settledTwd), 0.5);
});

test("embeddings are billed as input tokens", async () => {
  await subscribe(840);
  await (await import("../src/lib/models")).savePrice(userId, { modelId: "openai/text-embedding-3-small", label: "Embedding 3 small", vendor: "OpenAI", usd: { input: 0.02, cacheRead: 0.02, cacheWrite: 0.02, output: 0 }, enabled: true });
  llm.next.promptTokens = 5000;
  const r = await relay.relay(post("/api/v1/llm/embeddings", { model: "openai/text-embedding-3-small", input: ["a ".repeat(15000)] }), "openai", "embeddings");
  assert.equal(r.status, 200);
  const [row] = await rows();
  assert.equal(row.status, "SETTLED");
  assert.ok(Math.abs(Number(row.settledTwd) - (5000 * 0.702) / 1e6) < 1e-9);
});

test("a model that no longer accepts temperature: retried without it, remembered, client told; other 400s pass through", async () => {
  const compat = await import("../src/lib/llm/param-compat");
  compat.resetParamCompat();
  await subscribe(840);
  // Claude Opus 5.5 answers "`temperature` is deprecated for this model." - every SinoBee version sends temperature
  llm.next = { ...StubLlm.defaults(), chunks: 1, reject: ["temperature"] };
  const body = { model: "claude-sonnet-5.5", max_tokens: 100, temperature: 0.2, messages: [{ role: "user", content: "hi" }] };
  const r = await relay.relay(post("/api/v1/llm/anthropic/v1/messages", body), "anthropic", "messages");
  assert.equal(r.status, 200, "answered instead of a 400");
  assert.equal(r.headers.get("x-sinobee-dropped-params"), "temperature");
  assert.deepEqual(llm.requests.map((q) => q.body.temperature), [0.2, undefined], "sent again without it");
  assert.equal((await rows()).length, 1, "one hold, settled once");
  assert.equal((await rows())[0].status, "SETTLED");
  // remembered: the next request leaves it out from the start (also streaming)
  llm.requests = [];
  const s = await relay.relay(post("/api/v1/llm/anthropic/v1/messages", { ...body, stream: true }), "anthropic", "messages");
  assert.equal(s.status, 200);
  await readAll(s);
  assert.equal(llm.requests.length, 1);
  assert.equal(llm.requests[0].body.temperature, undefined);
  assert.equal(s.headers.get("x-sinobee-dropped-params"), "temperature");
  assert.deepEqual(compat.knownDropped(), { "claude-sonnet-5-5": ["temperature"] });
  // OpenAI wording, and a 400 that is about something else is returned as it is
  llm.requests = [];
  llm.next = { ...StubLlm.defaults(), chunks: 1, reject: ["top_p"] };
  const o = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, top_p: 0.9, messages: [{ role: "user", content: "x" }] }), "openai", "chat");
  assert.equal(o.status, 200);
  assert.deepEqual(llm.requests.map((q) => q.body.top_p), [0.9, undefined]);
  llm.requests = [];
  llm.next = { ...StubLlm.defaults(), status: 400 };
  const bad = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, temperature: 0.3, messages: [{ role: "user", content: "x" }] }), "openai", "chat");
  assert.equal(bad.status, 400);
  assert.equal(llm.requests.length, 1, "not retried");
  compat.resetParamCompat();
});

// ───────────── platform points (plan "模型分配與備援機制" P3, 2026-10-21) ─────────────

test("points: a call the user agreed to pay with points takes points 1:1 and leaves the windows alone", async () => {
  const points = await import("../src/lib/crowd/points");
  await subscribe(840);
  await db.pointLedger.deleteMany({ where: { userId } });
  await points.bookPoints({ userId, delta: 5, reason: "admin", ref: "llm-points:grant" });
  llm.next = { ...StubLlm.defaults(), promptTokens: 2000, chunks: 10 };
  const r = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "x" }], max_tokens: 500 }, { "x-sinobee-billing": "points" }), "openai", "chat");
  assert.equal(r.status, 200);
  const [row] = await rows();
  assert.equal(row.billing, "points");
  assert.equal(row.status, "SETTLED");
  // well under NT$1: the running total is rounded up to one whole point
  const booked = await db.pointLedger.findMany({ where: { userId, reason: "llm_usage" } });
  assert.deepEqual(booked.map((b) => b.delta), [-1]);
  assert.equal(booked[0].ref, `llm:${row.id}`);
  assert.equal(r.headers.get("x-sinobee-points"), "4");
  assert.equal(r.headers.get("x-sinobee-quota-6h"), null, "no window share for a points call");
  const st = await quota.quotaStatus(userId);
  assert.equal(st.windows[0].usedPct, 0, "the subscription windows are untouched");
  assert.deepEqual([st.points.balance, st.points.rate, st.points.unit], [4, 1, "TWD"]);
  assert.ok(st.points.available > 4 && st.points.available < 5, `${st.points.available}: plus the unused part of the point paid`);
  // a second small call fits in the point already paid for: nothing new is booked
  llm.next = { ...StubLlm.defaults(), promptTokens: 2000, chunks: 10 };
  await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "x" }], max_tokens: 500 }, { "x-sinobee-billing": "points" }), "openai", "chat");
  assert.equal((await db.pointLedger.findMany({ where: { userId, reason: "llm_usage" } })).length, 1);
  // a subscription call is still charged to the windows
  llm.next = { ...StubLlm.defaults(), chunks: 1 };
  await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "x" }] }), "openai", "chat");
  assert.ok((await quota.quotaStatus(userId)).windows[0].usedPct > 0);
});

test("points: refused when the points run out; works without a subscription; the quota API reports the balance", async () => {
  const points = await import("../src/lib/crowd/points");
  await subscribe(840);
  await db.pointLedger.deleteMany({ where: { userId } });
  const none = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "x" }] }, { "x-sinobee-billing": "points" }), "openai", "chat");
  assert.equal(none.status, 402);
  const j = await none.json();
  assert.equal(j.error.quota, "points");
  assert.equal((await rows()).length, 0, "nothing held");
  await points.bookPoints({ userId, delta: 3, reason: "admin", ref: "llm-points:grant2" });
  await db.subscription.deleteMany({ where: { userId } });
  const admin = await db.user.upsert({ where: { account: "0x" + "a".repeat(40) }, create: { account: "0x" + "a".repeat(40), role: "ADMIN", isAdmin: true }, update: {} });
  await plans.saveFreePlan(admin.id, { name: "免費", nameEn: "Free", maxCostTwd: 48, concurrency: 1, active: false });
  llm.next = { ...StubLlm.defaults(), chunks: 1 };
  const ok = await relay.relay(post("/api/v1/llm/chat/completions", { model: LUNA, messages: [{ role: "user", content: "x" }] }, { "x-sinobee-billing": "points" }), "openai", "chat");
  assert.equal(ok.status, 200, "points pay without a subscription");
  const route = await import("../src/app/api/v1/llm/quota/route");
  const q = await route.GET(new Request("http://localhost/api/v1/llm/quota", { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(q.status, 402);
  const body = await q.json();
  assert.equal(body.error.code, "subscription");
  assert.deepEqual(body.points, { balance: 2, rate: 1, unit: "TWD" });
});
