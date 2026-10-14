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
