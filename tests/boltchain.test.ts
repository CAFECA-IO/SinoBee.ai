import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { useTestDb } from "./helpers/testdb";
import { StubBoltchain } from "./helpers/stub-boltchain";

const { dir } = useTestDb();
const node = new StubBoltchain();
const WALLET = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

let db: typeof import("../src/lib/db").db;
let storage: typeof import("../src/lib/storage");
let swarm: typeof import("../src/lib/boltchain/swarm");
let keeper: typeof import("../src/lib/boltchain/keeper");
let certs: typeof import("../src/lib/boltchain/certificates");
let config: typeof import("../src/lib/config").config;
let site: string;

before(async () => {
  await node.start();
  Object.assign(process.env, {
    BOLT_RPC_URL: node.url, BOLT_WALLET_KEY: WALLET, BOLT_MASTER_KEY: randomBytes(32).toString("hex"),
    BOLT_CERTIFICATES: node.certificates, STORAGE_LOCAL_DIR: path.join(dir, "storage"), BOLT_DEAL_EPOCHS: "100", BOLT_RENEW_BELOW_EPOCHS: "10",
  });
  ({ db } = await import("../src/lib/db"));
  storage = await import("../src/lib/storage");
  swarm = await import("../src/lib/boltchain/swarm");
  keeper = await import("../src/lib/boltchain/keeper");
  certs = await import("../src/lib/boltchain/certificates");
  ({ config } = await import("../src/lib/config"));
  site = (await import("../src/lib/boltchain/chain")).siteAccount().address;
});
after(() => node.stop());

test("quote picks the n-th cheapest offer and SwarmStorage's rounding", async () => {
  const q = await swarm.quote(3n << 20n, 10n);
  assert.equal(q.replicas, 3);
  assert.equal(q.price, 3n * 10n ** 15n);
  assert.equal(q.cost, ((3n * 10n ** 15n * 3n + 1023n) / 1024n) * 3n * 10n);
});

test("seal → deal → read back through bolt_getBlocks", async () => {
  const data = randomBytes(1_500_000);
  const r = await swarm.storeSealed(data, "big.bin", "application/octet-stream");
  assert.equal(r.replicas, 3);
  const d = await swarm.dealInfo(r.dealId);
  assert.equal(d.root, r.root);
  assert.equal(d.owner.toLowerCase(), site.toLowerCase());
  const back = await swarm.readSealed(r.root, r.dealId, r.secretKey);
  assert.ok(Buffer.from(back).equals(data));
  // the wrong key cannot open it
  const other = (await import("../src/lib/boltchain/vault")).keyPair();
  await assert.rejects(swarm.readSealed(r.root, r.dealId, other.secretKey));
});

test("putObject moves objects to Boltchain right away; reads fall back; delete crypto-shreds", async () => {
  const body = Buffer.from("task result " + "x".repeat(5000));
  await storage.putObject("artifacts/t1/result.txt", body, "text/plain");
  let o = await db.storageObject.findUniqueOrThrow({ where: { key: "artifacts/t1/result.txt" } });
  assert.equal(o.status, "PENDING");
  assert.equal(o.kind, "artifacts");
  await keeper.keeperTick();
  o = await db.storageObject.findUniqueOrThrow({ where: { key: "artifacts/t1/result.txt" } });
  assert.equal(o.status, "STORED");
  assert.equal(o.dealState, "active");
  assert.ok(o.recipientKey && !o.recipientKey.includes(o.key));
  // mirror lost → served from Boltchain and checked against the hash
  await storage.mirrorDelete(o.key);
  assert.ok((await storage.getObject(o.key)).equals(body));
  // delete: key destroyed at once, deal cancelled by the keeper, then closed and refunded
  await storage.deleteObject(o.key);
  o = await db.storageObject.findUniqueOrThrow({ where: { key: o.key } });
  assert.equal(o.status, "DELETED");
  assert.equal(o.recipientKey, null);
  await assert.rejects(storage.getObject(o.key));
  await keeper.keeperTick();
  o = await db.storageObject.findUniqueOrThrow({ where: { key: o.key } });
  assert.equal(o.dealState, "cancelled");
  node.epoch += 2n;
  await keeper.keeperTick();
  o = await db.storageObject.findUniqueOrThrow({ where: { key: o.key } });
  assert.equal(o.dealState, "closed");
  assert.ok(node.deals[Number(o.dealId)].closed);
  assert.equal(node.balances.get(site.toLowerCase()) ?? 0n, 0n, "refund withdrawn");
});

test("failures back off and retry; overwrites get a new deal and the old one is cancelled", async () => {
  node.failHost = 1;
  await storage.putObject("skills/a/b/1.0.0.tar.gz", Buffer.from("v1"));
  await keeper.storePending();
  let o = await db.storageObject.findUniqueOrThrow({ where: { key: "skills/a/b/1.0.0.tar.gz" } });
  assert.equal(o.status, "PENDING");
  assert.match(o.error ?? "", /storage RPC disabled/);
  assert.ok(o.nextTryAt > new Date());
  await db.storageObject.update({ where: { key: o.key }, data: { nextTryAt: new Date(0) } });
  await keeper.storePending();
  o = await db.storageObject.findUniqueOrThrow({ where: { key: o.key } });
  assert.equal(o.status, "STORED");
  const firstDeal = o.dealId!;
  await storage.putObject(o.key, Buffer.from("v2"));
  await keeper.keeperTick();
  o = await db.storageObject.findUniqueOrThrow({ where: { key: o.key } });
  assert.equal(o.status, "STORED");
  assert.notEqual(o.dealId, firstDeal);
  const tomb = await db.storageObject.findUnique({ where: { key: `_cancel/${firstDeal}` } });
  assert.equal(tomb?.dealState, "cancelled");
});

test("deals are renewed before they end", async () => {
  await storage.putObject("vault/u1/pack", Buffer.from("secret pack"));
  await keeper.storePending();
  const o = await db.storageObject.findUniqueOrThrow({ where: { key: "vault/u1/pack" } });
  node.epoch = o.endEpoch! - 5n;
  await keeper.renewDeals();
  const r = await db.storageObject.findUniqueOrThrow({ where: { key: o.key } });
  assert.equal(r.endEpoch, o.endEpoch! + 100n);
  assert.equal(node.deals[Number(o.dealId)].end, r.endEpoch);
});

test("without a mirror the local copy is removed once stored, and reads come from Boltchain", async () => {
  const prev = process.env.BOLT_MIRROR;
  (config.boltchain as { mirror: boolean }).mirror = false;
  try {
    await storage.putObject("shares/s1/share.json", Buffer.from('{"m":1}'), "application/json");
    await keeper.storePending();
    assert.equal(existsSync(path.join(dir, "storage", "shares/s1/share.json")), false);
    assert.equal((await storage.getObject("shares/s1/share.json")).toString(), '{"m":1}');
  } finally {
    (config.boltchain as { mirror: boolean }).mirror = true;
    process.env.BOLT_MIRROR = prev;
  }
});

test("content hashes are notarized with Certificates and verifiable by code", async () => {
  const files = [certs.hashFile(Buffer.from("TOOL.json body")), certs.hashFile(Buffer.from("README"))];
  const a = await keeper.requestAnchor("tool-version", "tv1", files);
  assert.ok(a);
  await keeper.anchorPending();
  const done = await db.anchor.findUniqueOrThrow({ where: { id: a!.id } });
  assert.equal(done.status, "issued");
  const expect = certs.encodeCode(certs.codeOf(certs.rootOf(files), site as `0x${string}`, done.salt as `0x${string}`));
  assert.equal(done.code, expect);
  assert.equal(certs.decodeCode(certs.formatCode(done.code!).toLowerCase()), certs.codeOf(certs.rootOf(files), site as `0x${string}`, done.salt as `0x${string}`));
  const c = node.certs.get(certs.decodeCode(done.code!)!)!;
  assert.equal(c.root, certs.rootOf(files));
  // the manifest kept in the deal is the explorer's canonical JSON (hashes and sizes, no names)
  const { cidFromBytes } = await import("../src/lib/boltchain/cid");
  const { hexToBytes } = await import("viem");
  const manifest = node.blocks.get(cidFromBytes(hexToBytes(c.manifest)))!;
  assert.deepEqual(Buffer.from(manifest), Buffer.from(certs.certManifest(files, done.salt as `0x${string}`)));
  assert.equal(node.deals[Number(c.deal)].owner.toLowerCase(), node.certificates);
  // idempotent per target
  assert.equal((await keeper.requestAnchor("tool-version", "tv1", files))!.id, a!.id);
});

test("policies: shares keep 2 copies only until they expire; expired objects are shredded", async () => {
  const until = new Date(Date.now() + 10 * 3600_000);
  await storage.putObject("shares/p1/share.json", Buffer.from("{}"), "application/json", { keepUntil: until });
  await keeper.storePending();
  const o = await db.storageObject.findUniqueOrThrow({ where: { key: "shares/p1/share.json" } });
  assert.equal(o.replicas, 2);
  const d = node.deals[Number(o.dealId)];
  assert.equal(d.end - d.start, 11n, "10 h at 1 h per epoch, +1");
  // renewing never goes past keep-until
  node.epoch = d.end - 2n;
  await keeper.renewDeals();
  assert.equal(node.deals[Number(o.dealId)].end, d.end);
  await db.storageObject.update({ where: { key: o.key }, data: { keepUntil: new Date(Date.now() - 1000) } });
  await keeper.expireObjects();
  const e = await db.storageObject.findUniqueOrThrow({ where: { key: o.key } });
  assert.equal(e.status, "DELETED");
  assert.equal(e.recipientKey, null);
});

test("policies: retention keeps a deleted object readable until its date; vault versions cancel after 7 days", async () => {
  await storage.putObject("tools/u/t/1.0.0.json", Buffer.from('{"a":1}'));
  await keeper.storePending();
  await storage.deleteObject("tools/u/t/1.0.0.json", { retainDays: 90 });
  let o = await db.storageObject.findUniqueOrThrow({ where: { key: "tools/u/t/1.0.0.json" } });
  assert.equal(o.status, "STORED");
  assert.ok(o.deleteAfter && o.deleteAfter.getTime() > Date.now() + 89 * 86400_000);
  assert.equal((await storage.getObject(o.key)).toString(), '{"a":1}');
  await db.storageObject.update({ where: { key: o.key }, data: { deleteAfter: new Date(Date.now() - 1) } });
  await keeper.expireObjects();
  o = await db.storageObject.findUniqueOrThrow({ where: { key: o.key } });
  assert.equal(o.status, "DELETED");

  await storage.putObject("vault/u2/db_x", Buffer.from("v1"));
  await keeper.storePending();
  const v1 = (await db.storageObject.findUniqueOrThrow({ where: { key: "vault/u2/db_x" } })).dealId!;
  await storage.putObject("vault/u2/db_x", Buffer.from("v2"));
  const tomb = await db.storageObject.findUniqueOrThrow({ where: { key: `_cancel/${v1}` } });
  assert.ok(tomb.nextTryAt.getTime() > Date.now() + 6.9 * 86400_000, "old vault version kept 7 days");
  await keeper.cancelDeleted();
  assert.equal((await db.storageObject.findUniqueOrThrow({ where: { key: `_cancel/${v1}` } })).dealState, "active");
});

test("audit re-stores an object whose deal ended early; low balance notifies admins once a day", async () => {
  await storage.putObject("artifacts/t9/out.txt", Buffer.from("result"));
  await keeper.storePending();
  const o = await db.storageObject.findUniqueOrThrow({ where: { key: "artifacts/t9/out.txt" } });
  node.deals[Number(o.dealId)].closed = true;
  await keeper.auditDeals(50);
  const a = await db.storageObject.findUniqueOrThrow({ where: { key: o.key } });
  assert.equal(a.status, "PENDING");
  assert.match(a.error ?? "", /ended unexpectedly/);
  await keeper.storePending();
  assert.equal((await db.storageObject.findUniqueOrThrow({ where: { key: o.key } })).status, "STORED");

  const admin = await db.user.create({ data: { account: "0x" + "f".repeat(40), isAdmin: true } });
  process.env.BOLT_LOW_BALANCE_WEI = (10n ** 30n).toString();
  await keeper.checkBalance();
  await keeper.checkBalance();
  assert.equal(await db.notification.count({ where: { userId: admin.id, type: "storage.low_balance" } }), 1);
  delete process.env.BOLT_LOW_BALANCE_WEI;
});

test("objects stored before Boltchain are migrated; skill versions get a certificate", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const key = "skills/old/pkg/1.0.0.tar.gz";
  mkdirSync(path.join(dir, "storage", "skills/old/pkg"), { recursive: true });
  writeFileSync(path.join(dir, "storage", key), "old bundle");
  assert.equal(await storage.registerExisting(key, { contentType: "application/gzip" }), "queued");
  assert.equal(await storage.registerExisting(key), "tracked");
  assert.equal(await storage.registerExisting("skills/none/x.tar.gz"), "missing");
  await keeper.storePending(20);
  assert.equal((await db.storageObject.findUniqueOrThrow({ where: { key } })).status, "STORED");

  const u = await db.user.create({ data: { account: "0x" + "7".repeat(40), publisher: "old" } });
  const sk = await db.skill.create({ data: { publisherId: u.id, name: "pkg", description: "d" } });
  const v = await db.skillVersion.create({ data: { skillId: sk.id, version: "1.0.0", contentHash: "sha256:x", bundleKey: key, bundleSize: 10, manifest: {}, skillMd: "# md", files: {} } });
  await keeper.requestAnchor("skill-version", v.id, [certs.hashFile(Buffer.from("old bundle")), certs.hashFile(Buffer.from("# md"))]);
  await keeper.anchorPending(20);
  const after = await db.skillVersion.findUniqueOrThrow({ where: { id: v.id } });
  assert.match(after.anchorCode ?? "", /^[0-9A-HJKMNP-TV-Z]{16}$/);
});

test("gas headroom covers the testnet's gas variance", async () => {
  const { withHeadroom } = await import("../src/lib/boltchain/chain");
  // createDeal estimated at 507,030 used up to 540,493; issue at 719,616 used 724,625 (testnet, Oct 2026)
  assert.ok(withHeadroom(507_030n) > 540_493n * 12n / 10n);
  assert.ok(withHeadroom(719_616n) > 724_625n);
});
