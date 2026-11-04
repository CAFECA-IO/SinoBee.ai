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
const receipts: { ok: boolean; node: string; prompt: number; output: number }[] = [];

before(async () => {
  hubMod = await import("../src/lib/locutus/hub");
  hub = new hubMod.LocutusHub({
    name: "sinobee.test",
    enabled: () => enabled,
    secret: () => SECRET,
    nodes: () => hubMod.parseNodes([`${node.address}=test-node`]),
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
