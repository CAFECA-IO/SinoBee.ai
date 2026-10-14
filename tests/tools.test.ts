import { before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { useTestDb } from "./helpers/testdb";

const { dir } = useTestDb();
process.env.STORAGE_LOCAL_DIR = path.join(dir, "storage");
let db: typeof import("../src/lib/db").db;
let svc: typeof import("../src/lib/tools/service");
let spec: typeof import("../src/lib/tools/spec");
let vault: typeof import("../src/lib/vault");
type U = Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;
let alice: U, bob: U, admin: U;

const manifest = (o: Record<string, unknown> = {}) => ({
  schema: "sinobee.tool/v1", name: "shop-db", version: "1.0.0", kind: "database", title: "Shop analytics", description: "Orders and customers",
  database: { engine: "postgres", host: "db.example.com", port: 5432, database: "shop", sslmode: "require", readOnly: true, rowLimit: 500, timeoutS: 30 },
  tables: [{ schema: "sales", name: "orders", columns: [{ name: "id", type: "int" }] }],
  ...o,
});

before(async () => {
  ({ db } = await import("../src/lib/db"));
  svc = await import("../src/lib/tools/service");
  spec = await import("../src/lib/tools/spec");
  vault = await import("../src/lib/vault");
  alice = await db.user.create({ data: { account: "0x" + "1".repeat(40), handle: "alice", publisher: "alice" } });
  bob = await db.user.create({ data: { account: "0x" + "2".repeat(40), handle: "bob", publisher: "bob" } });
  admin = await db.user.create({ data: { account: "0x" + "3".repeat(40), isAdmin: true } });
});

test("credentials are rejected wherever they hide", () => {
  const m = (o: Record<string, unknown>) => spec.toolManifest.parse(manifest(o));
  assert.throws(() => spec.toolManifest.parse(manifest({ database: { engine: "postgres", password: "x" } })), /Unrecognized key/);
  const f1 = spec.scanTool(m({ description: "use postgres://admin:hunter2@db/shop" }), "PRIVATE");
  assert.ok(f1.some((f) => f.level === "error" && /password/.test(f.message)));
  const f2 = spec.scanTool(m({ queries: [{ title: "k", sql: "select 'sk-abcdefghijklmnopqrstuv'" }] }), "PRIVATE");
  assert.ok(f2.some((f) => f.level === "error"));
  const f3 = spec.scanTool(m({ vaultPack: "db:shop", database: { engine: "postgres", host: "10.0.0.5", readOnly: true, rowLimit: 5, timeoutS: 5 } }), "PUBLIC");
  assert.ok(f3.some((f) => f.level === "error" && /vault/.test(f.message)));
  assert.ok(f3.some((f) => f.level === "warning" && /private network/.test(f.message)));
  assert.equal(spec.toolHash(m({})), spec.toolHash(spec.toolManifest.parse(JSON.parse(JSON.stringify(manifest())))));
});

test("private tools are visible only to their owner and active at once", async () => {
  const r = await svc.publishTool(alice, manifest({ vaultPack: "db:shop" }), "PRIVATE");
  assert.equal(r.status, "active");
  assert.match(r.content_hash, /^sha256:/);
  await assert.rejects(svc.findTool(bob, "alice", "shop-db"), /not found/);
  await assert.rejects(svc.findTool(null, "alice", "shop-db"), /not found/);
  assert.equal((await svc.findTool(alice, "alice", "shop-db")).isOwner, true);
  await assert.rejects(svc.publishTool(alice, manifest({ vaultPack: "db:shop" }), "PRIVATE"), /already exists/);
});

test("public tools go through review; going public with a vault reference is refused", async () => {
  await assert.rejects(svc.setVisibility(alice, "shop-db", "PUBLIC"), /vault/);
  const r = await svc.publishTool(alice, manifest({ version: "1.1.0" }), "PUBLIC");
  assert.equal(r.status, "pending_review");
  await assert.rejects(svc.findTool(bob, "alice", "shop-db"), /not found/, "pending versions are not shown");
  const v = await db.toolVersion.findFirstOrThrow({ where: { version: "1.1.0" } });
  await svc.reviewTool(admin, v.id, true, "ok");
  const seen = await svc.findTool(bob, "alice", "shop-db");
  assert.equal(seen.isOwner, false);
  assert.deepEqual(seen.versions.map((x) => x.version), ["1.1.0"], "the private 1.0.0 (with its vault reference) stays hidden");
  assert.equal((await db.tool.findFirstOrThrow({ where: { name: "shop-db" } })).latestVersion, "1.1.0");
});

test("vault: key setup, sealed packs only, optimistic revisions, replace wipes packs", async () => {
  const pub = Buffer.alloc(32, 7).toString("base64");
  const wrapped = { v: 1 as const, kdf: { alg: "scrypt" as const, n: 32768, r: 8, p: 1, salt: "c2FsdA==" }, iv: "aXY=", ct: "Y3Q=" };
  await assert.rejects(vault.writePack(alice.id, "db:shop", "{}"), /vault key first/);
  await vault.setVaultKey(alice.id, { publicKey: pub, wrapped });
  await assert.rejects(vault.writePack(alice.id, "db:shop", '{"password":"plain"}'), /sealed envelope/);
  const env = JSON.stringify({ v: 1, epk: "ZQ==", iv: "aQ==", ct: "Yw==" });
  const p1 = await vault.writePack(alice.id, "db:shop", env);
  assert.equal(p1.revision, 1);
  await vault.writePack(alice.id, "db:shop", env, 1);
  await assert.rejects(vault.writePack(alice.id, "db:shop", env, 1), /stale revision/);
  assert.equal((await vault.readPack(alice.id, "db:shop")).data, env);
  await assert.rejects(vault.readPack(bob.id, "db:shop"), /not found/);
  // same key, new passphrase wrapping: packs stay
  await vault.setVaultKey(alice.id, { publicKey: pub, wrapped: { ...wrapped, ct: "bmV3" } });
  assert.equal((await vault.listPacks(alice.id)).length, 1);
  const other = Buffer.alloc(32, 9).toString("base64");
  await assert.rejects(vault.setVaultKey(alice.id, { publicKey: other, wrapped }), /replace/);
  await vault.setVaultKey(alice.id, { publicKey: other, wrapped, replace: true });
  assert.equal((await vault.listPacks(alice.id)).length, 0);
});

test("a later private version does not make a public tool private, nor show up publicly", async () => {
  await svc.publishTool(alice, manifest({ version: "1.2.0", vaultPack: "db:shop2" }), "PRIVATE");
  assert.equal((await db.tool.findFirstOrThrow({ where: { name: "shop-db" } })).visibility, "PUBLIC");
  assert.deepEqual((await svc.findTool(bob, "alice", "shop-db")).versions.map((x) => x.version), ["1.1.0"]);
});

test("deleting a tool removes every version", async () => {
  await svc.deleteTool(alice, "shop-db");
  assert.equal(await db.toolVersion.count(), 0);
});
