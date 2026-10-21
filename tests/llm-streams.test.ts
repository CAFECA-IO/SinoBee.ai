import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { useTestDb } from "./helpers/testdb";
import { StubLlm } from "./helpers/stub-llm";

useTestDb();
process.env.OPENAI_API_KEY = "sk-test-openai";
process.env.ANTHROPIC_API_KEY = "sk-test-anthropic";
process.env.LLM_RPM = "1000";
process.env.LLM_HEARTBEAT_MS = "60";
const llm = new StubLlm();

let db: typeof import("../src/lib/db").db;
let relay: typeof import("../src/lib/llm/relay");
let streams: typeof import("../src/lib/llm/streams");
let quota: typeof import("../src/lib/llm/quota");
let plans: typeof import("../src/lib/plans");
let streamRoute: typeof import("../src/app/api/v1/llm/streams/[id]/route");
let jobsRoute: typeof import("../src/app/api/v1/llm/jobs/route");
let jobRoute: typeof import("../src/app/api/v1/llm/jobs/[id]/route");
let token = "";
let userId = "";
const SONNET = "anthropic/claude-sonnet-5-5";

before(async () => {
  await llm.start();
  ({ db } = await import("../src/lib/db"));
  process.env.LLM_BASE_OPENAI = llm.url;
  process.env.LLM_BASE_ANTHROPIC = llm.url;
  relay = await import("../src/lib/llm/relay");
  streams = await import("../src/lib/llm/streams");
  quota = await import("../src/lib/llm/quota");
  plans = await import("../src/lib/plans");
  streamRoute = await import("../src/app/api/v1/llm/streams/[id]/route");
  jobsRoute = await import("../src/app/api/v1/llm/jobs/route");
  jobRoute = await import("../src/app/api/v1/llm/jobs/[id]/route");
  const user = await db.user.create({ data: { account: "0x" + "6".repeat(40), handle: "streamer" } });
  userId = user.id;
  token = "sbh_" + randomBytes(24).toString("base64url");
  await db.apiToken.create({ data: { userId, name: "device: test", prefix: token.slice(0, 10), tokenHash: createHash("sha256").update(token).digest("hex"), scopes: "llm" } });
  const admin = await db.user.create({ data: { account: "0x" + "b".repeat(40), role: "ADMIN", isAdmin: true } });
  const plan = await plans.savePlan(admin.id, { code: "s840", name: "s", nameEn: "s", feeTwd: 840, multiplier: 1 / 3, concurrency: 4, active: true });
  const pay = await db.payment.create({ data: { userId, purpose: "SUBSCRIPTION", provider: "MOCK", amount: 840, amountTwd: 840, amountBase: "840", token: "TWD", recipient: "mock", status: "CONFIRMED", planId: plan.id } });
  await db.subscription.create({ data: { userId, plan: plan.code, planId: plan.id, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 30 * 86400_000), paymentId: pay.id } });
});
after(() => llm.stop());

beforeEach(async () => {
  llm.next = StubLlm.defaults();
  llm.requests = [];
  quota.resetRpm();
  await db.usageLedger.deleteMany();
});

const hdr = () => ({ "content-type": "application/json", authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01" });
const msg = (extra: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/llm/anthropic/v1/messages", { method: "POST", headers: { ...hdr(), ...extra }, body: JSON.stringify({ model: SONNET, max_tokens: 2048, stream: true, messages: [{ role: "user", content: "write the page" }] }) });
const get = (url: string, extra: Record<string, string> = {}) => new Request(url, { headers: { authorization: `Bearer ${token}`, ...extra } });
const rows = () => db.usageLedger.findMany();
const settled = async () => {
  for (let i = 0; i < 100 && (await rows()).some((r) => r.status === "HELD"); i++) await new Promise((r) => setTimeout(r, 30));
  return rows();
};
const dataLines = (t: string) => t.split("\n").filter((l) => l.startsWith("data:"));

test("heartbeat: a silent upstream still sends ': ping' while the model buffers, and the answer is intact", async () => {
  llm.next = { ...StubLlm.defaults(), silenceMs: 400 };
  const text = await (await relay.relay(msg(), "anthropic", "messages")).text();
  assert.ok((text.match(/^: ping$/gm) ?? []).length >= 3, text.slice(0, 300));
  assert.equal(dataLines(text).filter((l) => l.includes("text_delta")).length, 5);
  assert.match(text, /message_stop/);
  assert.ok(!/^id: /m.test(text), "no event ids without a request id");
});

test("resumable: the call keeps running when the caller goes away; Last-Event-ID continues it; one upstream call, one charge", async () => {
  llm.next = { ...StubLlm.defaults(), chunks: 40, delayMs: 5 };
  const id = "req_" + randomBytes(6).toString("hex");
  const r = await relay.relay(msg({ "x-sinobee-request-id": id }), "anthropic", "messages");
  assert.equal(r.headers.get("x-sinobee-request-id"), id);
  const reader = r.body!.getReader();
  let first = "";
  while (!/^id: 3$/m.test(first)) first += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel(); // the edge cut the connection
  const seen = Math.max(...[...first.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1])));
  // a retry of the same POST joins the running call instead of calling the model again
  const joined = await relay.relay(msg({ "x-sinobee-request-id": id, "last-event-id": String(seen) }), "anthropic", "messages");
  const joinedText = await joined.text();
  assert.equal(llm.requests.length, 1, "one upstream call");
  assert.equal(llm.aborted, 0, "upstream not stopped");
  const firstId = Number(/^id: (\d+)$/m.exec(joinedText)![1]);
  assert.equal(firstId, seen + 1, "continues right after the last event seen");
  const all = (first + joinedText).match(/text_delta/g)!.length;
  assert.ok(all >= 40, `every delta delivered (${all})`);
  const [row] = await settled();
  assert.equal(row.status, "SETTLED");
  assert.equal((await rows()).length, 1, "one charge");
  // the GET resume reads the same events, also from another server process (PostgreSQL)
  const again = await (await streamRoute.GET(get(`http://localhost/api/v1/llm/streams/${id}`, { "last-event-id": "0" }), { params: Promise.resolve({ id }) })).text();
  await new Promise((r) => setTimeout(r, 1200));
  streams.forgetLocal();
  const fromDb = await (await streamRoute.GET(get(`http://localhost/api/v1/llm/streams/${id}?after=2`), { params: Promise.resolve({ id }) })).text();
  assert.deepEqual(dataLines(fromDb), dataLines(again).slice(dataLines(again).length - dataLines(fromDb).length));
  assert.match(fromDb, /^id: 3$/m);
  assert.match(fromDb, /message_stop/);
  // another user cannot read it
  const missing = await streamRoute.GET(get(`http://localhost/api/v1/llm/streams/nope-${id}`), { params: Promise.resolve({ id: `nope-${id}` }) });
  assert.equal(missing.status, 404);
});

test("without a request id a caller that goes away stops the upstream call (nobody could come back for it)", async () => {
  llm.next = { ...StubLlm.defaults(), chunks: 400, delayMs: 3 };
  const r = await relay.relay(msg(), "anthropic", "messages");
  const reader = r.body!.getReader();
  await reader.read();
  await reader.cancel();
  const [row] = await settled();
  assert.equal(row.status, "ESTIMATED");
  assert.match(row.error ?? "", /client aborted/);
  assert.ok(llm.aborted >= 1);
});

test("jobs: answered at once, polled in short requests until done; the same id joins; refused calls leave no job", async () => {
  llm.next = { ...StubLlm.defaults(), chunks: 30, delayMs: 5, silenceMs: 150 };
  const start = await jobsRoute.POST(new Request("http://localhost/api/v1/llm/jobs?format=anthropic", { method: "POST", headers: hdr(), body: JSON.stringify({ model: SONNET, max_tokens: 2048, messages: [{ role: "user", content: "write the page" }] }) }));
  assert.equal(start.status, 202);
  const { id } = (await start.json()) as { id: string };
  assert.match(id, /^job_/);
  let after = 0;
  let status = "running";
  let text = "";
  let polls = 0;
  while (status === "running" && polls++ < 50) {
    const r = (await (await jobRoute.GET(get(`http://localhost/api/v1/llm/jobs/${id}?after=${after}&wait=1`), { params: Promise.resolve({ id }) })).json()) as { status: string; events: string[]; next: number };
    text += r.events.join("");
    after = r.next;
    status = r.status;
  }
  assert.equal(status, "done");
  assert.equal(text.match(/text_delta/g)!.length, 30);
  assert.match(text, /message_stop/);
  assert.equal(llm.requests.length, 1);
  assert.equal(llm.requests[0].body.stream, true, "a job streams from the vendor");
  assert.equal((await settled()).length, 1);
  const dup = await jobsRoute.POST(new Request("http://localhost/api/v1/llm/jobs?format=anthropic", { method: "POST", headers: { ...hdr(), "x-sinobee-request-id": id }, body: JSON.stringify({ model: SONNET, max_tokens: 2048, messages: [{ role: "user", content: "x" }] }) }));
  assert.equal(((await dup.json()) as { joined: boolean }).joined, true);
  assert.equal(llm.requests.length, 1);
  // an upstream error: the error comes back on the POST and the id can be used again
  llm.next = { ...StubLlm.defaults(), status: 500 };
  const bad = await jobsRoute.POST(new Request("http://localhost/api/v1/llm/jobs?format=anthropic", { method: "POST", headers: { ...hdr(), "x-sinobee-request-id": "job-retry-1" }, body: JSON.stringify({ model: SONNET, max_tokens: 64, messages: [{ role: "user", content: "x" }] }) }));
  assert.equal(bad.status, 503);
  assert.equal(await streams.find(userId, "job-retry-1"), null);
});
