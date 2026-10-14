import { before, test } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "./helpers/testdb";

useTestDb();
let db: typeof import("../src/lib/db").db;
let flow: typeof import("../src/lib/device-flow");
let bearerAuth: typeof import("../src/lib/auth").bearerAuth;
let requireBearer: typeof import("../src/lib/auth").requireBearer;
let user: { id: string };

before(async () => {
  ({ db } = await import("../src/lib/db"));
  flow = await import("../src/lib/device-flow");
  ({ bearerAuth, requireBearer } = await import("../src/lib/auth"));
  user = await db.user.create({ data: { account: "0x" + "a".repeat(40), handle: "alice", publisher: "alice" } });
});
const req = (tok: string) => new Request("http://x/api/v1/me", { headers: { authorization: `Bearer ${tok}` } });

test("user codes are 8 unambiguous chars and normalize", () => {
  assert.equal(flow.normalizeUserCode("abcd-efgh"), "ABCDEFGH");
  assert.equal(flow.formatUserCode("ABCDEFGH"), "ABCD-EFGH");
  assert.throws(() => flow.parseScopes("skills:publish root"), /invalid_scope/);
  assert.deepEqual(flow.parseScopes(""), flow.DEFAULT_SCOPES);
});

test("full device flow: pending → slow_down → approve → token once", async () => {
  const s = await flow.startDeviceAuth({ deviceName: "laptop", platform: "linux", scope: "skills:publish tools:write" });
  assert.match(s.user_code, /^[A-HJ-KM-NP-TV-Z2-9]{4}-[A-HJ-KM-NP-TV-Z2-9]{4}$/);
  assert.equal(s.interval, 5);
  assert.deepEqual(await flow.pollDeviceToken(s.device_code), { ok: false, error: "authorization_pending" });
  assert.deepEqual(await flow.pollDeviceToken(s.device_code), { ok: false, error: "slow_down" });
  assert.ok(await flow.pendingByUserCode(s.user_code.toLowerCase()));
  await flow.decideDeviceAuth(user.id, s.user_code, true);
  await assert.rejects(flow.decideDeviceAuth(user.id, s.user_code, true), /code_not_found/);
  const r = await flow.pollDeviceToken(s.device_code);
  assert.ok(r.ok);
  const tok = (r as unknown as { body: { access_token: string; scope: string } }).body;
  assert.match(tok.access_token, /^sbh_/);
  assert.equal(tok.scope, "skills:publish tools:write");
  assert.deepEqual(await flow.pollDeviceToken(s.device_code), { ok: false, error: "invalid_grant" });

  const a = await bearerAuth(req(tok.access_token));
  assert.equal(a?.user.id, user.id);
  assert.deepEqual(a?.scopes, ["skills:publish", "tools:write"]);
  await requireBearer(req(tok.access_token), "tools:write");
  await assert.rejects(requireBearer(req(tok.access_token), "vault:rw"), /lacks scope/);

  // signing the device out kills the token
  await flow.revokeDevice(user.id, a!.device!.id);
  assert.equal(await bearerAuth(req(tok.access_token)), null);
});

test("denied and expired requests", async () => {
  const s = await flow.startDeviceAuth({ deviceName: "x" });
  await flow.decideDeviceAuth(user.id, s.user_code, false);
  assert.deepEqual(await flow.pollDeviceToken(s.device_code), { ok: false, error: "access_denied" });
  const e = await flow.startDeviceAuth({ deviceName: "y" });
  await db.deviceAuth.updateMany({ where: { userCode: flow.normalizeUserCode(e.user_code) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.deepEqual(await flow.pollDeviceToken(e.device_code), { ok: false, error: "expired_token" });
  assert.equal(await flow.pendingByUserCode(e.user_code), null);
  assert.deepEqual(await flow.pollDeviceToken("nope".repeat(10)), { ok: false, error: "invalid_grant" });
});

test("expired tokens are rejected", async () => {
  const s = await flow.startDeviceAuth({ deviceName: "z" });
  await flow.decideDeviceAuth(user.id, s.user_code, true);
  const r = (await flow.pollDeviceToken(s.device_code)) as unknown as { body: { access_token: string } };
  await db.apiToken.updateMany({ where: { prefix: r.body.access_token.slice(0, 10) }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal(await bearerAuth(req(r.body.access_token)), null);
});

test("sign-in requests are rate limited per IP and keep the device key", async () => {
  const pk = Buffer.alloc(32, 5).toString("base64");
  for (let i = 0; i < 10; i++) await flow.startDeviceAuth({ deviceName: "r", ip: "203.0.113.9", publicKey: pk });
  await assert.rejects(flow.startDeviceAuth({ deviceName: "r", ip: "203.0.113.9" }), /too many/);
  await flow.startDeviceAuth({ deviceName: "r", ip: "203.0.113.10" });
  await assert.rejects(flow.startDeviceAuth({ deviceName: "r", publicKey: "short" }), /32-byte/);
  const s = await flow.startDeviceAuth({ deviceName: "k", ip: "198.51.100.1", publicKey: pk });
  await flow.decideDeviceAuth(user.id, s.user_code, true);
  const r = (await flow.pollDeviceToken(s.device_code)) as unknown as { body: { device_id: string; expires_in: number } };
  assert.equal(r.body.expires_in, 90 * 86400);
  assert.equal((await db.device.findUniqueOrThrow({ where: { id: r.body.device_id } })).publicKey, pk);
});
