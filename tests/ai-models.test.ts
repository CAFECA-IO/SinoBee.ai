import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { useTestDb } from "./helpers/testdb";

useTestDb();

let db: typeof import("../src/lib/db").db;
let ai: typeof import("../src/lib/ai-models");
let pm: typeof import("../src/lib/platform-model");
let models: typeof import("../src/lib/models");
let admin: { id: string };

/** One fake server for every provider: model lists and chat requests */
const calls: string[] = [];
let anthropicListFails = false;
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = req.url!;
    const send = (status: number, j: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(typeof j === "string" ? j : JSON.stringify(j));
    };
    if (req.method === "GET") {
      calls.push(`GET ${url}`);
      if (url === "/openai/models") return send(200, { data: [{ id: "gpt-good" }, { id: "text-embedding-3-small" }, { id: "gpt-missing" }, { id: "whisper-1" }] });
      if (url === "/gemini/models") return send(200, { data: [{ id: "models/gemini-x", display_name: "Gemini X" }, { id: "models/text-embedding-004" }] });
      if (url.startsWith("/anthropic/v1/models")) {
        if (anthropicListFails) return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
        return url.includes("after_id")
          ? send(200, { data: [{ id: "claude-b", display_name: "Claude B" }], has_more: false })
          : send(200, { data: [{ id: "claude-a", display_name: "Claude A" }], has_more: true, last_id: "claude-a" });
      }
      return send(404, { error: { message: "no route" } });
    }
    const j = JSON.parse(body);
    calls.push(`POST ${url} ${j.model}${j.tools ? " +tools" : ""}`);
    if (url.startsWith("/gemini")) return send(404, [{ error: { code: 404, message: `models/${j.model} is not found`, status: "NOT_FOUND" } }]);
    if (url.startsWith("/anthropic")) {
      if (j.tools) return send(400, { type: "error", error: { type: "invalid_request_error", message: "web search is not enabled for this organization" } });
      const ids = String(j.messages[0].content).split("\n").slice(1).map((l: string) => l.split(" — ")[0]);
      const text = JSON.stringify({ models: ids.map((id: string) => (id.includes("mystery") ? { id, found: false } : { id, found: true, input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15, note: "official pricing page" })) });
      return send(200, { content: [{ type: "text", text: `Here you go:\n${text}` }], usage: { input_tokens: 100, output_tokens: 50 } });
    }
    if (j.model === "gpt-missing") return send(404, { error: { message: "The model `gpt-missing` does not exist" } });
    return send(200, { choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
  });
});

before(async () => {
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  Object.assign(process.env, {
    OPENAI_API_KEY: "o", LLM_BASE_OPENAI: `${base}/openai`,
    GEMINI_API_KEY: "g", LLM_BASE_GEMINI: `${base}/gemini`,
    ANTHROPIC_API_KEY: "a", LLM_BASE_ANTHROPIC: `${base}/anthropic`,
  });
  delete process.env.DEEPSEEK_API_KEY;
  ({ db } = await import("../src/lib/db"));
  ai = await import("../src/lib/ai-models");
  pm = await import("../src/lib/platform-model");
  models = await import("../src/lib/models");
  admin = await db.user.create({ data: { account: "0x" + "f".repeat(40), handle: "admin" } });
});
after(() => srv.close());

const ask = (job: "spec" | "screening" | "checklist" | "pricing") => pm.platformChat({ job, system: "s", messages: [{ role: "user", content: "ping" }], maxTokens: 100 });

test("the model lists come from each provider's API, without non-chat models; a failing provider keeps its last list", async () => {
  const c = await ai.syncCatalog(admin.id);
  assert.deepEqual(c.openai.models.map((m) => m.id), ["gpt-good", "gpt-missing"]);
  assert.deepEqual(c.gemini.models, [{ id: "gemini-x", label: "Gemini X" }], "the models/ prefix is dropped");
  assert.deepEqual(c.anthropic.models.map((m) => m.id), ["claude-a", "claude-b"], "every page");
  assert.equal(c.deepseek, undefined, "no key, no list");
  anthropicListFails = true;
  const c2 = await ai.syncCatalog(admin.id);
  assert.match(c2.anthropic.error!, /401 invalid x-api-key/);
  assert.equal(c2.anthropic.models.length, 2);
  anthropicListFails = false;
  await ai.syncCatalog(admin.id);
});

test("tiers only take listed models; each job uses its tier: primary first, then the fallbacks in order", async () => {
  const jobs = { spec: "high", screening: "standard", checklist: "light", pricing: "high" } as const;
  await assert.rejects(ai.saveTierConfig(admin.id, { tiers: { high: ["openai/gpt-typo"], standard: [], light: [] }, jobs }), /not in openai's model list/);
  await assert.rejects(ai.saveTierConfig(admin.id, { tiers: { high: ["acme/x"], standard: [], light: [] }, jobs }), /unknown provider/);
  const saved = await ai.saveTierConfig(admin.id, { tiers: { high: ["gemini/gemini-x", "openai/gpt-missing", "openai/gpt-good"], standard: ["openai/gpt-good"], light: [] }, jobs });
  assert.ok(saved.missingPrices.includes("openai/gpt-good"), "the platform's models need a price row");

  calls.length = 0;
  const r = await ask("spec");
  assert.equal(r.text, "pong");
  assert.equal(r.modelId, "openai/gpt-good");
  assert.equal(r.price, null, "no price row yet: not charged");
  assert.deepEqual(calls, ["POST /gemini/chat/completions gemini-x", "POST /openai/chat/completions gpt-missing", "POST /openai/chat/completions gpt-good"], "primary, fallback 1, fallback 2");
  calls.length = 0;
  await ask("spec");
  assert.deepEqual(calls, ["POST /openai/chat/completions gpt-good"], "models that just failed go last");
  calls.length = 0;
  assert.equal((await ask("screening")).modelId, "openai/gpt-good");

  // an empty tier is automatic: offered models with a key, Model prices order
  const auto = await pm.jobModels("checklist");
  assert.equal(auto.configured.length, 0);
  assert.ok(auto.models.length > 0 && auto.models.every((m) => m.price?.enabled));
});

test("all models of a tier fail: the error names each one with the provider's message; no key: a clear 503", async () => {
  const jobs = { spec: "high", screening: "standard", checklist: "light", pricing: "high" } as const;
  await ai.saveTierConfig(admin.id, { tiers: { high: ["gemini/gemini-x", "openai/gpt-missing"], standard: ["deepseek/deepseek-chat"], light: [] }, jobs });
  await assert.rejects(ask("spec"), (e: Error) => {
    assert.match(e.message, /gemini\/gemini-x: 404 models\/gemini-x is not found/);
    assert.match(e.message, /openai\/gpt-missing: 404 The model `gpt-missing` does not exist/);
    return true;
  });
  await assert.rejects(ask("screening"), (e: Error & { status?: number }) => {
    assert.match(e.message, /deepseek\/deepseek-chat\) has an API key/);
    return true;
  });
  assert.equal(await pm.jobHasModel("screening"), false);
});

test("synced models are added to Model prices with AI-looked-up prices, withdrawn until an admin checks them", async () => {
  const jobs = { spec: "high", screening: "standard", checklist: "light", pricing: "standard" } as const;
  await ai.saveTierConfig(admin.id, { tiers: { high: [], standard: ["anthropic/claude-a"], light: [] }, jobs });
  calls.length = 0;
  const added = await ai.addModelsWithAiPrices(admin.id, ["openai/gpt-good", "anthropic/mystery-model"]);
  assert.deepEqual(calls.filter((c) => c.startsWith("POST")), ["POST /anthropic/v1/messages claude-a +tools", "POST /anthropic/v1/messages claude-a"], "web search first, then without when refused");
  assert.deepEqual(added[0].usd, { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 });
  assert.equal(added[1].note, "price not found");
  const rows = await models.pricesAt(new Date(8.64e15));
  const good = rows.find((m) => m.modelId === "openai/gpt-good")!;
  assert.equal(good.enabled, false, "not offered until checked");
  assert.equal(good.usd.output, 15);
  assert.equal(good.vendor, "OpenAI");
  assert.equal(rows.find((m) => m.modelId === "anthropic/mystery-model")!.usd.input, 0);
  assert.ok(!(await models.currentModels()).some((m) => m.modelId === "openai/gpt-good"));

  // the platform charges its calls at that price now
  await ai.saveTierConfig(admin.id, { tiers: { high: ["openai/gpt-good"], standard: ["anthropic/claude-a"], light: [] }, jobs });
  assert.equal((await ask("spec")).price?.usd.output, 15);

  // the background job the admin page polls
  assert.equal(ai.priceLookupState().state, "idle");
  ai.startPriceLookup(admin.id, ["gemini/gemini-x"]);
  assert.throws(() => ai.startPriceLookup(admin.id, ["gemini/gemini-x"]), /already running/);
  for (let i = 0; i < 100 && ai.priceLookupState().state === "running"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(ai.priceLookupState().state, "done");
});
