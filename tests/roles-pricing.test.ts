import { before, test } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "./helpers/testdb";
import { bufferFor, planMargin } from "../src/lib/price-math";

useTestDb();
delete process.env.OWNER_ACCOUNT;
process.env.ADMIN_ACCOUNTS = "0x" + "a".repeat(40);

let db: typeof import("../src/lib/db").db;
let auth: typeof import("../src/lib/auth");
let roles: typeof import("../src/lib/roles");
let models: typeof import("../src/lib/models");
let plans: typeof import("../src/lib/plans");
let config: typeof import("../src/lib/config").config;

const acc = (c: string) => "0x" + c.repeat(40);
const signIn = (account: string, handle?: string) =>
  auth.upsertUser({ account, claims: { handle: handle ?? null } } as unknown as Parameters<typeof auth.upsertUser>[0]);

before(async () => {
  ({ db } = await import("../src/lib/db"));
  auth = await import("../src/lib/auth");
  roles = await import("../src/lib/roles");
  models = await import("../src/lib/models");
  plans = await import("../src/lib/plans");
  ({ config } = await import("../src/lib/config"));
});

async function reset() {
  await db.adminAudit.deleteMany();
  await db.siteSetting.deleteMany();
  await db.user.deleteMany();
}

// ───────────── P1: roles ─────────────

test("OWNER_ACCOUNT: a stranger signing in first gets nothing; the owner's first sign-in makes it SUPERADMIN", async () => {
  await reset();
  config.ownerAccount = acc("0");
  try {
    const stranger = await signIn(acc("1"), "first");
    assert.equal(stranger.role, "USER", "first sign-in is not enough");
    assert.equal(stranger.isAdmin, false);
    const owner = await signIn(acc("0"), "owner");
    assert.equal(owner.role, "SUPERADMIN");
    assert.equal(owner.isAdmin, true);
    assert.equal(await roles.issueClaimCode(() => undefined), null, "no claim code when OWNER_ACCOUNT is set");
    // signing in again never changes roles
    assert.equal((await signIn(acc("1"))).role, "USER");
    assert.equal((await signIn(acc("0"))).role, "SUPERADMIN");
    const log = await db.adminAudit.findMany({ where: { action: "owner.bootstrap" } });
    assert.equal(log.length, 1);
  } finally {
    config.ownerAccount = undefined;
  }
});

test("after a transfer the old owner account is not re-promoted at sign-in", async () => {
  await reset();
  config.ownerAccount = acc("0");
  try {
    const owner = await signIn(acc("0"));
    const bob = await signIn(acc("2"), "bob");
    await roles.transferSuperAdmin(owner, bob.id, acc("2"));
    assert.equal((await signIn(acc("0"))).role, "ADMIN");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: bob.id } })).role, "SUPERADMIN");
    assert.equal(await db.user.count({ where: { role: "SUPERADMIN" } }), 1);
  } finally {
    config.ownerAccount = undefined;
  }
});

test("claim code: printed once, single use, wrong codes refused, non-owner first sign-in stays USER", async () => {
  await reset();
  let printed = "";
  const code = await roles.issueClaimCode((s) => (printed = s));
  assert.ok(code && printed.includes(code), "code goes to the log");
  const stored = await db.siteSetting.findUnique({ where: { key: "owner.claim" } });
  assert.ok(stored && !stored.value.includes(code!.replace(/-/g, "")), "only the hash is stored");

  const first = await signIn(acc("3"), "first");
  assert.equal(first.role, "USER", "being first does not make you owner");
  const other = await signIn(acc("4"), "other");
  await assert.rejects(roles.claimSite(other, "AAAA-BBBB-CCCC"), /wrong code/);
  const won = await roles.claimSite(other, code!.toLowerCase().replace(/-/g, " "));
  assert.equal(won.role, "SUPERADMIN");
  await assert.rejects(roles.claimSite(first, code!), /already has an owner/);
  assert.equal(await roles.issueClaimCode(() => undefined), null, "no new code once owned");
});

test("too many wrong claim codes rotate the code", async () => {
  await reset();
  const code = (await roles.issueClaimCode(() => undefined))!;
  const u = await signIn(acc("5"));
  for (let i = 0; i < 9; i++) await assert.rejects(roles.claimSite(u, "ZZZZ-ZZZZ-ZZZZ"), /wrong code/);
  await assert.rejects(roles.claimSite(u, "ZZZZ-ZZZZ-ZZZZ"), /too many/);
  await assert.rejects(roles.claimSite(u, code), /wrong code/, "the old code died");
});

test("ADMIN_ACCOUNTS only seeds the first role; grant, revoke and limits of the super admin", async () => {
  await reset();
  const code = (await roles.issueClaimCode(() => undefined))!;
  const boss = await roles.claimSite(await signIn(acc("6"), "boss"), code);
  const seeded = await signIn(acc("a"), "seeded");
  assert.equal(seeded.role, "ADMIN", "listed in ADMIN_ACCOUNTS");
  await roles.setRole(boss, seeded.id, "USER");
  assert.equal((await signIn(acc("a"))).role, "USER", "revocation survives the next sign-in");

  const carol = await signIn(acc("7"), "carol");
  const granted = await roles.setRole(boss, carol.id, "ADMIN");
  assert.equal(granted.role, "ADMIN");
  assert.equal(granted.isAdmin, true);
  await assert.rejects(roles.setRole(granted, seeded.id, "ADMIN"), /only the super admin/, "admins cannot grant");
  await assert.rejects(roles.setRole(boss, boss.id, "USER"), /own role/);
  const revoked = await roles.setRole(boss, carol.id, "USER");
  assert.equal(revoked.role, "USER");
  assert.equal(revoked.isAdmin, false);
  await assert.rejects(roles.transferSuperAdmin(boss, carol.id, acc("8")), /does not match/);

  const actions = (await db.adminAudit.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
  for (const a of ["owner.bootstrap", "role.revoke", "role.grant"]) assert.ok(actions.includes(a), `audited: ${a}`);
});

// ───────────── P2: prices & plans ─────────────

test("published price = vendor USD × FX × buffer; history and scheduled changes", async () => {
  await reset();
  await db.modelPrice.deleteMany();
  const admin = await signIn(acc("9"));
  const now = await models.currentModels();
  assert.ok(now.length >= 10, "defaults copied on first use");
  const haiku = now.find((m) => m.modelId === "anthropic/claude-haiku-5-5")!;
  assert.equal(haiku.fx, 32.5);
  assert.equal(haiku.buffer, 1.2);
  assert.deepEqual(haiku.twd, { input: 3.9, cacheRead: 0.39, cacheWrite: 4.875, output: 19.5 });
  const sonnet = now.find((m) => m.modelId === "anthropic/claude-sonnet-5-5")!;
  assert.equal(sonnet.twd.input, 78);
  assert.equal(sonnet.twd.output, 390);

  // cheapest model for quota display: Haiku, blended (3·3.9 + 19.5) / 4 = 7.8
  const cheap = await models.cheapestBlended();
  assert.equal(cheap?.model.modelId, "anthropic/claude-haiku-5-5");
  assert.ok(Math.abs(cheap!.blendedTwd - 7.8) < 1e-9);

  await models.savePrice(admin.id, { modelId: haiku.modelId, label: haiku.label, vendor: haiku.vendor, usd: { ...haiku.usd, output: 0.6 }, enabled: true });
  assert.equal((await models.currentModels()).find((m) => m.modelId === haiku.modelId)!.twd.output, 23.4);
  assert.equal((await models.priceHistory(haiku.modelId)).length, 2, "old row kept");

  const later = new Date(Date.now() + 86400_000);
  await models.savePrice(admin.id, { modelId: "x-ai/grok-9", label: "Grok 9", vendor: "xAI", usd: { input: 1, cacheRead: 0.1, cacheWrite: 1, output: 4 }, enabled: true, effectiveAt: later });
  assert.ok(!(await models.currentModels()).some((m) => m.modelId === "x-ai/grok-9"), "not yet in force");
  assert.equal((await models.pricesAt(new Date(+later + 1000))).find((m) => m.modelId === "x-ai/grok-9")?.twd.output, 156);
  await assert.rejects(models.savePrice(admin.id, { modelId: "bad id", label: "x", vendor: "y", usd: { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 }, enabled: true }), /provider\/model/);
  await assert.rejects(
    models.savePrice(admin.id, { modelId: "a/b", label: "x", vendor: "y", usd: { input: -1, cacheRead: 1, cacheWrite: 1, output: 1 }, enabled: true }),
    /invalid input/,
  );

  // FX change: every model gets a new row at the new rate
  await models.savePricingSettings(admin.id, { fx: 33, buffer: 1.1 });
  const h2 = (await models.currentModels()).find((m) => m.modelId === haiku.modelId)!;
  assert.equal(h2.fx, 33);
  assert.equal(h2.twd.input, models.publishedTwd(0.1, 33, 1.1));
  assert.ok(await db.adminAudit.findFirst({ where: { action: "pricing.settings" } }));

  // withdrawing a model hides it from the offer but keeps its name for old tasks
  await models.savePrice(admin.id, { modelId: h2.modelId, label: h2.label, vendor: h2.vendor, usd: h2.usd, enabled: false });
  assert.ok(!(await models.currentModels()).some((m) => m.modelId === h2.modelId));
  assert.equal((await models.modelLabels())[h2.modelId], "Claude Haiku 5.5");
  await models.savePricingSettings(admin.id, { fx: 32.5, buffer: 1.2 });
});

test("plans: allowance = fee × usage multiplier (Pro 1.5×, Ultra 5×); margin = buffer ÷ multiplier", async () => {
  await reset();
  await db.plan.deleteMany();
  const admin = await signIn(acc("b"));
  const list = await plans.listPlans();
  const low = list.find((p) => p.code === "low")!;
  const high = list.find((p) => p.code === "high")!;
  assert.deepEqual([low.feeTwd, low.multiplier, low.maxCostTwd, low.l168Twd, low.l6Twd], [840, 1.5, 1260, 262.5, 26.25]);
  assert.deepEqual([high.feeTwd, high.multiplier, high.maxCostTwd, high.l168Twd, high.l6Twd], [3675, 5, 18375, 3828.13, 382.81]);
  // maxing every window over 30 days uses exactly the allowance
  const l168 = 18375 / 4.8;
  assert.ok(Math.abs(4 * l168 + Math.min(l168, 8 * (l168 / 10)) - 18375) < 1e-9);
  // the buffer, not the plan, decides the margin
  assert.ok(Math.abs(planMargin(1.5, 1.08) - 0.72) < 1e-9);
  assert.equal(planMargin(5, 7.5), 1.5);
  assert.equal(bufferFor([1.5, 5]), 5);
  assert.equal(bufferFor([1.5, 5], 1.5), 7.5);

  await assert.rejects(plans.savePlan(admin.id, { ...high, multiplier: 0 }), /between 0 and 100/);
  await assert.rejects(plans.savePlan(admin.id, { ...high, multiplier: 101 }), /between 0 and 100/);
  assert.equal((await plans.listPlans()).find((p) => p.code === "high")!.multiplier, 5, "unchanged after refusal");
  const saved = await plans.savePlan(admin.id, { ...low, feeTwd: 900, multiplier: 2 });
  assert.deepEqual([saved.maxCostTwd, saved.l168Twd, saved.l6Twd], [1800, 375, 37.5]);
  await assert.rejects(plans.savePlan(admin.id, { code: "high", name: "x", nameEn: "x", feeTwd: 1, multiplier: 2, concurrency: 1, active: true }), /exists/);
  assert.ok(await db.adminAudit.findFirst({ where: { action: "plan.update", targetId: low.id } }));
});
