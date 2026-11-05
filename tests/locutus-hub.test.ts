import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";
import { privateKeyToAccount } from "viem/accounts";
import { useTestDb } from "./helpers/testdb";

/**
 * Locutus hub (src/lib/locutus/hub.ts): Borg Locutus nodes link in over WebSocket and supply models to the relay
 * as provider `locutus`. A fake node here speaks `borg-locutus-link/1` (Borg docs/spec/locutus-platform-link.md)
 * and signs with viem - the Rust node's signatures are checked against the same viem vector in Borg's tests.
 */

useTestDb();
const SECRET = "hub-" + randomBytes(16).toString("hex");
process.env.LOCUTUS_ENABLED = "1";
process.env.LOCUTUS_HUB_SECRET = SECRET;
process.env.LLM_RPM = "1000";

const NODE_KEY = "0x" + "11".repeat(32);
const OTHER_KEY = "0x" + "22".repeat(32);
const node = privateKeyToAccount(NODE_KEY as `0x${string}`);
const stranger = privateKeyToAccount(OTHER_KEY as `0x${string}`);

let hubMod: typeof import("../src/lib/locutus/hub");
let hub: InstanceType<typeof import("../src/lib/locutus/hub").LocutusHub>;
let server: http.Server;
let base = "";
let enabled = true;
let registered = [`${node.address}=test-node`];
let blockedList: string[] = [];
const receipts: { ok: boolean; node: string; prompt: number; output: number }[] = [];

before(async () => {
  hubMod = await import("../src/lib/locutus/hub");
  hub = new hubMod.LocutusHub({
    name: "sinobee.test",
    enabled: () => enabled,
    secret: () => SECRET,
    nodes: () => hubMod.parseNodes(registered),
    blocked: () => new Set(blockedList),
    reload: async () => undefined,
    log: () => undefined,
    pingMs: 60_000,
    headMs: 2_000,
    onReceipt: (r, ok, n) => receipts.push({ ok, node: n, prompt: r.prompt, output: r.output }),
  });
  server = http.createServer(hub.http);
  server.on("upgrade", hub.upgrade);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.LOCUTUS_HUB_URL = base;
});
after(() => {
  hub.close();
  server.close();
});
beforeEach(() => {
  enabled = true;
  registered = [`${node.address}=test-node`];
  blockedList = [];
  receipts.length = 0;
});

type Frame = Record<string, unknown> & { t: string };
type Behaviour = "answer" | "slow" | "die" | "fail-busy" | "bad-receipt";

/** A fake Borg node. `jobs` records what it was sent; `behaviour` decides how it answers. */
class FakeNode {
  ws!: WebSocket;
  jobs: Frame[] = [];
  cancels: string[] = [];
  closed = false;
  refused = "";
  behaviour: Behaviour = "answer";
  constructor(
    private account = node,
    private models = [{ id: "qwen-test", sha256: "abc123", formats: ["openai"], context: 65536 }],
    private signer = account,
    private tsOffset = 0,
  ) {}

  /** resolves "welcome" or the refusal message */
  link(): Promise<string> {
    this.ws = new WebSocket(`${base.replace("http", "ws")}/locutus/link`);
    return new Promise((resolve) => {
      this.ws.on("message", async (raw) => {
        const f = JSON.parse(String(raw)) as Frame;
        if (f.t === "challenge") {
          const ts = Math.floor(Date.now() / 1000) + this.tsOffset;
          const msg = hubMod.helloMessage(String(f.hub), String(f.nonce), this.account.address, ts);
          const sig = await this.signer.signMessage({ message: msg });
          this.ws.send(JSON.stringify({ t: "hello", v: 1, address: this.account.address.toLowerCase(), ts, sig, agent: "fake/1", slots: 1, models: this.models }));
        } else if (f.t === "welcome") resolve("welcome");
        else if (f.t === "error") {
          this.refused = String(f.message);
          resolve(this.refused);
        } else if (f.t === "job") void this.answer(f);
        else if (f.t === "cancel") this.cancels.push(String(f.id));
      });
      this.ws.on("close", () => {
        this.closed = true;
        resolve(this.refused || "closed");
      });
    });
  }

  private async answer(f: Frame) {
    this.jobs.push(f);
    const id = String(f.id);
    const send = (o: object) => this.ws.send(JSON.stringify(o));
    if (this.behaviour === "fail-busy") return send({ t: "fail", id, status: 503, message: "node busy" });
    send({ t: "head", id, status: 200, type: "text/event-stream" });
    const chunks = ['data: {"choices":[{"delta":{"content":"你好"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n', 'data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":300}}\n\n', "data: [DONE]\n\n"];
    for (const [i, c] of chunks.entries()) {
      if (this.behaviour === "slow") await new Promise((r) => setTimeout(r, 300));
      if (this.cancels.includes(id)) return;
      if (this.behaviour === "die" && i === 1) return this.ws.terminate();
      send({ t: "data", id, chunk: c });
    }
    const request = createHash("sha256").update(String(f.body), "utf8").digest("hex");
    const r = { id, request, model: "qwen-test", model_sha256: "abc123", prompt: 1200, output: 300, address: this.account.address.toLowerCase() };
    const sig = await this.account.signMessage({ message: hubMod.receiptMessage(this.behaviour === "bad-receipt" ? { ...r, output: 3 } : r) });
    send({ t: "end", id, receipt: { ...r, sig } });
  }
}

const call = (path: string, body: object | null, key = SECRET, signal?: AbortSignal) =>
  fetch(`${base}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal });

const waitFor = async (f: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

test("only registered nodes with a valid signature and clock can link", async () => {
  assert.match(await new FakeNode(stranger).link(), /not registered/);
  // signed by another key than the address it claims
  assert.match(await new FakeNode(node, undefined, stranger).link(), /signature/);
  assert.match(await new FakeNode(node, undefined, node, 600).link(), /clock/);
  enabled = false;
  assert.match(await new FakeNode().link(), /turned off/);
  enabled = true;
  const n = new FakeNode();
  assert.equal(await n.link(), "welcome");
  assert.equal(hub.status()[0].label, "test-node");
  // a second link from the same node replaces the first
  const again = new FakeNode();
  assert.equal(await again.link(), "welcome");
  await waitFor(() => n.closed);
  assert.equal(hub.status().length, 1);
  again.ws.close();
  await waitFor(() => hub.status().length === 0);
});

test("the relay's side: key required, models of linked nodes, a streamed answer with a checked receipt", async () => {
  assert.equal((await call("/openai/models", null, "wrong-key-of-the-same-len".padEnd(SECRET.length, "x"))).status, 401);
  assert.deepEqual((await (await call("/openai/models", null)).json()).data, []);
  const n = new FakeNode();
  await n.link();
  const models = (await (await call("/openai/models", null)).json()).data;
  assert.deepEqual(models.map((m: { id: string }) => m.id), ["qwen-test"]);

  const body = { model: "qwen-test", stream: true, messages: [{ role: "user", content: "hi" }] };
  const r = await call("/openai/chat/completions", body);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/event-stream");
  assert.equal(r.headers.get("x-sinobee-locutus-node"), "test-node");
  const text = await r.text();
  assert.ok(text.includes("你好") && text.includes("，世界") && text.endsWith("data: [DONE]\n\n"));
  // the body reached the node as the exact text the relay sent
  assert.equal(n.jobs[0].path, "chat/completions");
  assert.equal(n.jobs[0].body, JSON.stringify(body));
  await waitFor(() => receipts.length === 1);
  assert.deepEqual(receipts[0], { ok: true, node: "test-node", prompt: 1200, output: 300 });
  assert.equal(hub.status()[0].served, 1);

  // a receipt that does not match what the node signed is flagged
  n.behaviour = "bad-receipt";
  await (await call("/openai/chat/completions", body)).text();
  await waitFor(() => receipts.length === 2);
  assert.equal(receipts[1].ok, false);
  assert.equal(hub.status()[0].badReceipts, 1);
  n.ws.close();
  await waitFor(() => hub.status().length === 0);
});

test("no node, a busy node, a node that dies mid-stream, a caller that goes away", async () => {
  const body = { model: "qwen-test", stream: true, messages: [{ role: "user", content: "hi" }] };
  const none = await call("/openai/chat/completions", body);
  assert.equal(none.status, 503);
  assert.match((await none.json()).error.message, /no Locutus node serving qwen-test/);

  const n = new FakeNode();
  await n.link();
  // the Anthropic format: this node only declared openai
  assert.equal((await call("/openai/messages", { model: "qwen-test", max_tokens: 10, messages: [] })).status, 503);
  n.behaviour = "fail-busy";
  const busy = await call("/openai/chat/completions", body);
  assert.equal(busy.status, 503);
  assert.match((await busy.json()).error.message, /node busy/);

  n.behaviour = "slow";
  const ac = new AbortController();
  const r = await call("/openai/chat/completions", body, SECRET, ac.signal);
  assert.equal(r.status, 200);
  ac.abort();
  await waitFor(() => n.cancels.length === 1);
  await waitFor(() => hub.jobs.size === 0);

  n.behaviour = "die";
  const broken = await call("/openai/chat/completions", body);
  await assert.rejects(broken.text(), "the stream breaks when the node goes away");
  await waitFor(() => hub.status().length === 0);
});

test("through the relay: provider locutus, held and settled from the node's usage at the admin's price", async () => {
  const { db } = await import("../src/lib/db");
  const models = await import("../src/lib/models");
  const plans = await import("../src/lib/plans");
  const relay = await import("../src/lib/llm/relay");
  const { config } = await import("../src/lib/config");
  assert.equal(config.llm.providers.locutus.base, `${base}/openai`);
  assert.equal(config.llm.providers.locutus.key, SECRET);

  const admin = await db.user.create({ data: { account: "0x" + "a".repeat(40), role: "ADMIN", isAdmin: true } });
  await models.savePrice(admin.id, { modelId: "locutus/qwen-test", label: "Qwen test (Locutus)", vendor: "Locutus", usd: { input: 0.1, cacheRead: 0.01, cacheWrite: 0.1, output: 0.4 }, enabled: true });
  const user = await db.user.create({ data: { account: "0x" + "4".repeat(40), handle: "bee" } });
  const token = "sbh_" + randomBytes(24).toString("base64url");
  await db.apiToken.create({ data: { userId: user.id, name: "device: test", prefix: token.slice(0, 10), tokenHash: createHash("sha256").update(token).digest("hex"), scopes: "llm" } });
  const plan = await plans.savePlan(admin.id, { code: "t840", name: "t", nameEn: "t", feeTwd: 840, multiplier: 1 / 3, concurrency: 2, active: true });
  const startsAt = new Date(Date.now() - 8 * 86400_000);
  const pay = await db.payment.create({ data: { userId: user.id, purpose: "SUBSCRIPTION", provider: "MOCK", amount: 840, amountTwd: 840, amountBase: "840", token: "TWD", recipient: "mock", status: "CONFIRMED", planId: plan.id } });
  await db.subscription.create({ data: { userId: user.id, plan: plan.code, planId: plan.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 86400_000), paymentId: pay.id } });

  const n = new FakeNode();
  await n.link();
  const req = new Request("http://localhost/api/v1/llm/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: "locutus/qwen-test", stream: true, messages: [{ role: "user", content: "你好" }] }),
  });
  const r = await relay.relay(req, "openai", "chat");
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(text.includes("你好"), text);
  // the relay forced usage reporting and sent the upstream model name; the node got that body
  const sent = JSON.parse(String(n.jobs[0].body));
  assert.equal(sent.model, "qwen-test");
  assert.deepEqual(sent.stream_options, { include_usage: true });
  await waitFor(() => receipts.length === 1);
  let row = await db.usageLedger.findFirst({ orderBy: { createdAt: "desc" } });
  for (let i = 0; i < 50 && row?.status === "HELD"; i++) {
    await new Promise((r) => setTimeout(r, 50));
    row = await db.usageLedger.findFirst({ orderBy: { createdAt: "desc" } });
  }
  assert.equal(row?.modelId, "locutus/qwen-test");
  assert.equal(row?.status, "SETTLED");
  assert.deepEqual([row?.promptTokens, row?.outputTokens], [1200, 300], "settled from the usage the node passed through");
  n.ws.close();
  await waitFor(() => hub.status().length === 0);
});

test("route: only Locutus models a linked node serves; a free one gets a real score; images only when its node says so", async () => {
  const { db } = await import("../src/lib/db");
  const models = await import("../src/lib/models");
  const { rank } = await import("../src/lib/llm/route");
  const admin = await db.user.findFirst({ where: { isAdmin: true } }) ?? await db.user.create({ data: { account: "0x" + "b".repeat(40), role: "ADMIN", isAdmin: true } });
  await models.ensureModelPrices();
  await db.modelPrice.updateMany({ data: { enabled: false } });
  const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  await models.savePrice(admin.id, { modelId: "locutus/qwen-free", label: "Qwen free", vendor: "Locutus", usd: zero, enabled: true });
  await models.savePrice(admin.id, { modelId: "locutus/gemma-eyes", label: "Gemma eyes", vendor: "Locutus", usd: zero, enabled: true });
  models.invalidateModelCache();

  const reset = () => ((globalThis as { __sbLocutusServed?: unknown }).__sbLocutusServed = undefined);
  reset();
  await assert.rejects(rank({ role: "main", preference: "balanced", task_kind: "chat" }), /no model fits/, "offered, but no node serves them");

  const n = new FakeNode(node, [
    { id: "qwen-free", sha256: "a1", formats: ["openai"], context: 65536 },
    { id: "gemma-eyes", sha256: "b2", formats: ["openai"], context: 65536, vision: true } as never,
  ]);
  await n.link();
  reset();
  const r = await rank({ role: "main", preference: "balanced", task_kind: "chat", needs: { tools: true } });
  assert.deepEqual(r.ranked.map((x) => x.model).sort(), ["locutus/gemma-eyes", "locutus/qwen-free"]);
  for (const x of r.ranked) assert.ok(Number.isFinite(x.score), `score of ${x.model}: ${x.score}`);

  const v = await rank({ role: "main", preference: "balanced", task_kind: "chat", needs: { vision: true } });
  assert.deepEqual(v.ranked.map((x) => x.model), ["locutus/gemma-eyes"], "only the model its node declared as seeing");
  n.ws.close();
  await waitFor(() => hub.status().length === 0);
});

test("an unregistered node that proves its address waits for approval; approval, removal and blocking take effect", async () => {
  // refused, but listed with what it declared (only after a valid signature)
  const s = new FakeNode(stranger, [{ id: "gemma-eyes", sha256: "b2", formats: ["openai"], context: 32768, vision: true } as never]);
  assert.match(await s.link(), /not registered on this platform yet/);
  assert.match(await new FakeNode(stranger, undefined, node).link(), /signature/);
  let st = (await (await call("/status", null)).json()) as { pending: { address: string; models: { id: string; vision: boolean }[]; attempts: number }[] };
  assert.equal(st.pending.length, 1, "a bad signature is not listed");
  assert.equal(st.pending[0].address, stranger.address.toLowerCase());
  assert.deepEqual(st.pending[0].models.map((m) => [m.id, m.vision]), [["gemma-eyes", true]]);

  // ignored: gone from the list, and stays gone when it retries
  assert.equal((await call("/ignore", { address: stranger.address })).status, 200);
  await new FakeNode(stranger).link();
  st = await (await call("/status", null)).json();
  assert.equal(st.pending.length, 0);

  // approved (registered): links; removed: dropped at the next reload
  registered = [`${node.address}=test-node`, `${stranger.address}=eyes`];
  const n2 = new FakeNode(stranger);
  assert.equal(await n2.link(), "welcome");
  registered = [`${node.address}=test-node`];
  assert.equal((await call("/reload", {})).status, 200);
  await waitFor(() => n2.closed);
  assert.match(n2.refused, /no longer registered/);

  // blocked: refused outright, never listed
  blockedList = [node.address.toLowerCase()];
  assert.match(await new FakeNode(node).link(), /blocked/);
  st = await (await call("/status", null)).json();
  assert.equal(st.pending.length, 0);
  await waitFor(() => hub.status().length === 0);
});

test("the admin card: approving a waiting node registers it and offers its models; prices and offering from the card", async () => {
  const { db } = await import("../src/lib/db");
  const models = await import("../src/lib/models");
  const admin = await import("../src/lib/locutus/admin");
  const { svList } = await import("../src/lib/settings/cache");
  const third = privateKeyToAccount(("0x" + "33".repeat(32)) as `0x${string}`); // test 6 ignored `stranger` in this hub
  const actor = (await db.user.findFirst({ where: { isAdmin: true } })) ?? (await db.user.create({ data: { account: "0x" + "c".repeat(40), role: "ADMIN", isAdmin: true } }));

  const s = new FakeNode(third, [{ id: "gemma-eyes2", sha256: "b2", formats: ["openai"], context: 32768, vision: true } as never]);
  await s.link();
  let o = await admin.locutusOverview();
  const w = o.pending.find((p) => p.address === third.address.toLowerCase());
  assert.ok(w, "the waiting node is on the card");

  await assert.rejects(admin.registerNode(actor.id, third.address, "bad name"), /name/);
  const r = await admin.registerNode(actor.id, third.address, "149-eyes", true);
  assert.deepEqual(r.offered, ["locutus/gemma-eyes2"]);
  assert.ok(svList("locutus.nodes").includes(`${third.address.toLowerCase()}=149-eyes`));
  models.invalidateModelCache();
  const row = (await models.currentModels()).find((m) => m.modelId === "locutus/gemma-eyes2");
  assert.equal(row?.enabled, true);
  assert.equal(row?.usd.input, 0);

  // the card sets a price and withdraws it
  await admin.setModel(actor.id, { modelId: "locutus/gemma-eyes2", input: 0.05, output: 0.2, enabled: false });
  models.invalidateModelCache();
  o = await admin.locutusOverview();
  const m = o.models.find((x) => x.modelId === "locutus/gemma-eyes2");
  assert.deepEqual([m?.enabled, m?.usd.input, m?.usd.output], [false, 0.05, 0.2]);
  await assert.rejects(admin.setModel(actor.id, { modelId: "openai/gpt-x", input: 0, output: 0, enabled: true }), /not a Locutus model/);

  // block: unregistered and listed as blocked; unblock
  await admin.blockNode(actor.id, third.address);
  assert.ok(!svList("locutus.nodes").some((x) => x.startsWith(third.address.toLowerCase())));
  assert.ok(svList("locutus.blocked").includes(third.address.toLowerCase()));
  await admin.unblockNode(actor.id, third.address);
  assert.equal(svList("locutus.blocked").length, 0);

  // the link URL node operators copy is a WebSocket URL
  const store = await import("../src/lib/settings/store");
  await store.saveSetting(actor.id, "locutus.publicUrl", "wss://sinobee.test/locutus/link");
  await assert.rejects(store.saveSetting(actor.id, "locutus.publicUrl", "https://sinobee.test/locutus/link"), /wss\/ws URL/);
});

test("model warnings: Locutus models are checked against the linked nodes, not the synced catalog", async () => {
  const { db } = await import("../src/lib/db");
  const models = await import("../src/lib/models");
  const { modelProblems } = await import("../src/app/[locale]/admin/_sections/warnings");
  const actor = (await db.user.findFirst({ where: { isAdmin: true } })) ?? (await db.user.create({ data: { account: "0x" + "d".repeat(40), role: "ADMIN", isAdmin: true } }));
  const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  await models.savePrice(actor.id, { modelId: "locutus/qwen-test", label: "q", vendor: "Locutus", usd: zero, enabled: true });
  await models.savePrice(actor.id, { modelId: "locutus/ghost", label: "g", vendor: "Locutus", usd: zero, enabled: true });
  models.invalidateModelCache();
  const n = new FakeNode();
  await n.link();
  (globalThis as { __sbLocutusServed?: unknown }).__sbLocutusServed = undefined;
  const p = await modelProblems();
  const unserved = p.unserved.map((m) => m.modelId);
  assert.ok(unserved.includes("locutus/ghost") && !unserved.includes("locutus/qwen-test"), unserved.join(", "));
  assert.ok(!p.unknown.some((m) => m.modelId.startsWith("locutus/")), "never 'not in the vendor's list'");
  n.ws.close();
  await waitFor(() => hub.status().length === 0);
});

test("model warnings: a paused vendor's models are not failing now, but what to fix before resuming is listed", async () => {
  const { db } = await import("../src/lib/db");
  const models = await import("../src/lib/models");
  const pause = await import("../src/lib/llm/pause");
  const { settingsCache } = await import("../src/lib/settings/cache");
  const { modelProblems } = await import("../src/app/[locale]/admin/_sections/warnings");
  const actor = (await db.user.findFirst({ where: { isAdmin: true } })) ?? (await db.user.create({ data: { account: "0x" + "e".repeat(40), role: "ADMIN", isAdmin: true } }));
  const usd = { input: 1, cacheRead: 0.1, cacheWrite: 1, output: 2 };
  await models.savePrice(actor.id, { modelId: "deepseek/ds-test", label: "DS test", vendor: "DeepSeek", usd, enabled: true });
  await models.savePrice(actor.id, { modelId: "openai/gpt-test", label: "GPT test", vendor: "OpenAI", usd, enabled: true });
  models.invalidateModelCache();
  // openai has a key the vendor rejected at the last catalog sync; deepseek has none
  settingsCache().values.set("apiKeys.openai", "sk-expired");
  await db.siteSetting.upsert({ where: { key: "ai.catalog" }, create: { key: "ai.catalog", value: JSON.stringify({ openai: { at: new Date().toISOString(), models: [], error: "401 Your API key has expired." } }) }, update: { value: JSON.stringify({ openai: { at: new Date().toISOString(), models: [], error: "401 Your API key has expired." } }) } });
  (globalThis as { __sbAi?: unknown }).__sbAi = null;

  let p = await modelProblems();
  assert.ok(p.noKey.some((m) => m.modelId === "deepseek/ds-test"));
  assert.ok(p.badKey.some((m) => m.modelId === "openai/gpt-test"), "a rejected key is a failure too");

  await pause.setPaused(actor.id, "deepseek", true);
  await pause.setPaused(actor.id, "openai", true);
  await pause.pauses(true);
  p = await modelProblems();
  assert.ok(!p.noKey.some((m) => m.modelId.startsWith("deepseek/")) && !p.badKey.some((m) => m.modelId.startsWith("openai/")), "paused: no calls, so not failing");
  assert.deepEqual(p.whenResumed.map((w) => `${w.vendor}:${w.why}`).sort(), ["deepseek:noKey", "openai:badKey"]);
  await pause.setPaused(actor.id, "deepseek", false);
  await pause.setPaused(actor.id, "openai", false);
  settingsCache().values.delete("apiKeys.openai");
});
