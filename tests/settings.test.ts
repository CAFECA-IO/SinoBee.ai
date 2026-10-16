import { before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { useTestDb } from "./helpers/testdb";

const { dir } = useTestDb();
for (const k of ["OEN_API_TOKEN", "OEN_MERCHANT_ID", "LEGAL_ENTITY", "HUB_SIGNING_KEY", "BOLT_WALLET_KEY", "BOLT_MASTER_KEY", "RUNNER_CPUS", "LLM_RPM"]) delete process.env[k];

let db: typeof import("../src/lib/db").db;
let store: typeof import("../src/lib/settings/store");
let cache: typeof import("../src/lib/settings/cache");
let config: typeof import("../src/lib/config").config;
let signing: typeof import("../src/lib/skills/signing");
let adminId = "";

before(async () => {
  ({ db } = await import("../src/lib/db"));
  store = await import("../src/lib/settings/store");
  cache = await import("../src/lib/settings/cache");
  ({ config } = await import("../src/lib/config"));
  signing = await import("../src/lib/skills/signing");
  adminId = (await db.user.create({ data: { account: "0x" + "5".repeat(40), role: "SUPERADMIN", isAdmin: true } })).id;
  await store.loadSettings({ refreshEveryMs: 0 });
});

test("keys are generated once, stored encrypted, and the key file is private", async () => {
  const made = await store.generateMissing(() => undefined);
  assert.deepEqual(made.sort(), ["boltchain.masterKey", "boltchain.walletKey", "hub.signingKey"]);
  assert.deepEqual(await store.generateMissing(() => undefined), [], "only once");
  const row = await db.siteSetting.findUniqueOrThrow({ where: { key: "cfg.hub.signingKey" } });
  assert.match(row.value, /^enc:v1:/, "encrypted at rest");
  assert.ok(!row.value.includes(config.hub.signingKey));
  const keyFile = path.join(dir, "secrets.key");
  assert.ok(existsSync(keyFile));
  assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  assert.match(config.boltchain.walletKey, /^0x[0-9a-f]{64}$/);
  assert.equal(signing.hubPublicKeys().length, 1);
  assert.ok(signing.signContentHash("sha256:" + "0".repeat(64)));
  // a fresh process reads them back
  cache.settingsCache().values.clear();
  await store.loadSettings({ refreshEveryMs: 0 });
  assert.match(config.boltchain.masterKey, /^[0-9a-f]{64}$/);
});

test(".env values move into the database; the file keeps only bootstrap lines and a backup is kept", async () => {
  const file = path.join(dir, ".env");
  writeFileSync(file, ["# site", "DATABASE_URL=", "PUBLIC_ORIGIN=https://sinobee.ai", "OEN_MERCHANT_ID=sinobee", "OEN_API_TOKEN=tok-123456789", "LEGAL_ENTITY=CAFECA", "RUNNER_CPUS=4", "PAYMENT_MODE=nonsense", ""].join("\n"));
  process.env.OEN_API_TOKEN = "tok-123456789"; // as dotenv would have loaded it
  const moved = await store.importEnvFile(file, () => undefined);
  assert.deepEqual(moved.sort(), ["LEGAL_ENTITY", "OEN_API_TOKEN", "OEN_MERCHANT_ID", "RUNNER_CPUS"]);
  const text = readFileSync(file, "utf8");
  assert.match(text, /^PUBLIC_ORIGIN=https:\/\/sinobee\.ai$/m, "bootstrap values stay");
  assert.match(text, /^# OEN_API_TOKEN → moved to the database/m);
  assert.match(text, /^PAYMENT_MODE=nonsense$/m, "invalid values are left for a human");
  assert.ok(!text.includes("tok-123456789"));
  assert.ok(readdirSync(dir).some((f) => f.startsWith(".env.bak-")));
  assert.equal(process.env.OEN_API_TOKEN, undefined, "no longer locked by the environment");
  assert.equal(config.oen.token, "tok-123456789");
  assert.equal(config.oen.merchantId, "sinobee");
  assert.equal(config.runner.cpus, 4);
  assert.equal(config.legal.entity, "卡菲卡金融科技股份有限公司", "the old example placeholder is not imported");
  const row = await db.siteSetting.findUniqueOrThrow({ where: { key: "cfg.oen.token" } });
  assert.match(row.value, /^enc:v1:/);
});

test("environment wins and is locked; admin edits are validated and audited without secret values", async () => {
  process.env.LLM_RPM = "5";
  assert.equal(config.llm.rpm, 5);
  await assert.rejects(store.saveSetting(adminId, "llm.rpm", "10"), /environment variable LLM_RPM/);
  delete process.env.LLM_RPM;
  await store.saveSetting(adminId, "llm.rpm", "10");
  assert.equal(config.llm.rpm, 10);
  await assert.rejects(store.saveSetting(adminId, "oen.env", "staging"), /one of testing, production/);
  await assert.rejects(store.saveSetting(adminId, "oen.methods", "cvs,bitcoin"), /unknown value bitcoin/);
  await store.saveSetting(adminId, "oen.token", "new-secret-token");
  const a = await db.adminAudit.findFirstOrThrow({ where: { targetId: "oen.token" }, orderBy: { createdAt: "desc" } });
  assert.ok(!JSON.stringify(a.detail).includes("new-secret-token"));
  const view = store.settingsForAdmin();
  const tok = view.items.find((i) => i.key === "oen.token")!;
  assert.equal(tok.value, "", "secrets never go to the browser");
  assert.equal(tok.hint, "••••oken");
  assert.equal(view.items.find((i) => i.key === "boltchain.walletKey")!.derived?.startsWith("0x"), true);
  await store.saveSetting(adminId, "llm.rpm", "");
  assert.equal(config.llm.rpm, 60, "cleared → default");
});

test("rotating the skill signing key keeps the old public key published", async () => {
  const before = signing.hubPublicKeys()[0];
  await store.rotateHubKey(adminId);
  const keys = signing.hubPublicKeys();
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], before);
  assert.equal(keys[1], before);
});
