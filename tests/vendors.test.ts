import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "./helpers/testdb";

/**
 * Model vendors (src/lib/llm/vendors.ts): each one has its key and API address settings, a link to where the key is
 * made, a relay provider, and its key goes into task containers.
 */

useTestDb();
process.env.XAI_API_KEY = "xai-test";

test("every vendor has a key setting with where to get it, an API address, and a relay provider", async () => {
  const { VENDORS } = await import("../src/lib/llm/vendors");
  const { SETTING } = await import("../src/lib/settings/registry");
  const { config } = await import("../src/lib/config");
  const store = await import("../src/lib/settings/store");
  await store.loadSettings({ refreshEveryMs: 0 });
  assert.ok(VENDORS.length >= 10);
  for (const v of VENDORS) {
    const key = SETTING[`apiKeys.${v.id}`];
    assert.equal(key?.type, "secret", v.id);
    assert.equal(key.env, v.env);
    assert.match(key.link!.url, /^https:\/\//, `${v.id} links to where its key is made`);
    assert.equal(SETTING[`llm.base.${v.id}`]?.default, v.base);
    assert.equal(config.llm.providers[v.id].kind, v.kind);
  }
  // the key comes from its environment variable and goes into task containers
  assert.equal(config.llm.providers.xai.key, "xai-test");
  assert.equal(config.llm.providers.xai.base, "https://api.x.ai/v1");
  assert.ok(config.runner.containerEnv.some(([k, v]) => k === "XAI_API_KEY" && v === "xai-test"));
  // the admin view carries the link
  const view = store.settingsForAdmin().items.find((i) => i.key === "apiKeys.mistral");
  assert.equal(view?.link?.url, "https://console.mistral.ai/");
});

test("router model ids (openrouter/org/model) can be priced", async () => {
  const { db } = await import("../src/lib/db");
  const models = await import("../src/lib/models");
  const u = await db.user.create({ data: { account: "0x" + "f".repeat(40), role: "ADMIN", isAdmin: true } });
  const usd = { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 };
  const row = await models.savePrice(u.id, { modelId: "openrouter/anthropic/claude-sonnet-5", label: "Sonnet via OpenRouter", vendor: "OpenRouter", usd, enabled: true });
  assert.equal(row.modelId, "openrouter/anthropic/claude-sonnet-5");
  await assert.rejects(models.savePrice(u.id, { modelId: "openrouter/a/b/c", label: "x", vendor: "x", usd, enabled: true }), /provider\/model/);
});

test("a vendor's spend today against its daily cap (settled today + held now), and its environment override", async () => {
  const { db } = await import("../src/lib/db");
  const { providerSpendToday } = await import("../src/lib/llm/quota");
  const { settingsCache } = await import("../src/lib/settings/cache");
  const u = await db.user.create({ data: { account: "0x" + "e".repeat(40) } });
  const yesterday = new Date(Date.now() - 2 * 86400_000);
  await db.usageLedger.createMany({
    data: [
      { userId: u.id, modelId: "xai/grok-test", endpoint: "chat", status: "SETTLED", heldTwd: 10, settledTwd: 30, priceTwd: {}, settledAt: new Date() },
      { userId: u.id, modelId: "xai/grok-test", endpoint: "chat", status: "HELD", heldTwd: 15, priceTwd: {} },
      { userId: u.id, modelId: "xai/grok-test", endpoint: "chat", status: "SETTLED", heldTwd: 10, settledTwd: 500, priceTwd: {}, createdAt: yesterday, settledAt: yesterday },
      { userId: u.id, modelId: "mistral/other", endpoint: "chat", status: "SETTLED", heldTwd: 10, settledTwd: 99, priceTwd: {}, settledAt: new Date() },
    ],
  });
  settingsCache().values.set("llm.dailyLimitTwd", "40");
  let s = await providerSpendToday("xai");
  assert.equal(s.spent, 45);
  assert.equal(s.limit, 40);
  assert.equal(s.reached, true);
  assert.equal(s.fromEnv, null);
  process.env.LLM_DAILY_LIMIT_TWD_XAI = "100";
  s = await providerSpendToday("xai");
  assert.deepEqual([s.limit, s.reached, s.fromEnv], [100, false, "LLM_DAILY_LIMIT_TWD_XAI"]);
  delete process.env.LLM_DAILY_LIMIT_TWD_XAI;
  settingsCache().values.delete("llm.dailyLimitTwd");
});
