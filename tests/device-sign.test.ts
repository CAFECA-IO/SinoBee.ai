import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { useTestDb } from "./helpers/testdb";

useTestDb();
delete process.env.LLM_REQUIRE_SIGNATURE;

let db: typeof import("../src/lib/db").db;
let flow: typeof import("../src/lib/device-flow");
let auth: typeof import("../src/lib/auth");
let sig: typeof import("../src/lib/device-sign");
let relay: typeof import("../src/lib/llm/relay");
let userId = "";

const B = "https://sinobee.ai";
function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  return { priv: privateKey, pub: Buffer.from(raw).toString("base64") };
}

/** what SinoBee does: sign METHOD, path+query, timestamp, nonce and sha256(body) */
function signed(priv: KeyObject, token: string, method: string, path: string, body = "", o: { ts?: number; nonce?: string; bodySent?: string; pathSent?: string } = {}) {
  const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
  const nonce = o.nonce ?? randomBytes(16).toString("base64url");
  const msg = `${method}\n${path}\n${ts}\n${nonce}\n${createHash("sha256").update(body).digest("hex")}`;
  const s = sign(null, Buffer.from(msg), priv).toString("base64");
  return new Request(B + (o.pathSent ?? path), {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-sb-timestamp": ts, "x-sb-nonce": nonce, "x-sb-signature": s },
    body: method === "GET" ? undefined : (o.bodySent ?? body),
  });
}

async function login(signingKey?: string) {
  const start = await flow.startDeviceAuth({ deviceName: "SinoBee test", scope: "llm vault:rw", signingKey });
  await flow.decideDeviceAuth(userId, start.user_code, true);
  const r = await flow.pollDeviceToken(start.device_code);
  assert.ok(r.ok);
  return r.body as { access_token: string; refresh_token?: string; expires_in: number; device_id: string };
}

before(async () => {
  ({ db } = await import("../src/lib/db"));
  flow = await import("../src/lib/device-flow");
  auth = await import("../src/lib/auth");
  sig = await import("../src/lib/device-sign");
  relay = await import("../src/lib/llm/relay");
  userId = (await db.user.create({ data: { account: "0x" + "6".repeat(40), handle: "dev" } })).id;
});

test("a device with a signing key gets a 15-minute access token and a refresh token", async () => {
  const k = keypair();
  const t = await login(k.pub);
  assert.equal(t.expires_in, 900);
  assert.match(t.refresh_token!, /^sbr_/);
  const d = await db.device.findUniqueOrThrow({ where: { id: t.device_id } });
  assert.equal(d.signingKey, k.pub);
  await assert.rejects(flow.startDeviceAuth({ deviceName: "x", signingKey: "short" }), /Ed25519/);
});

test("signed requests pass; unsigned, replayed, late, altered or foreign-key requests fail", async () => {
  const k = keypair();
  const t = await login(k.pub);
  const ok = await auth.bearerAuth(signed(k.priv, t.access_token, "POST", "/api/v1/llm/chat/completions?x=1", '{"a":1}'));
  assert.equal(ok?.signed, true);
  assert.equal(ok?.user.id, userId);

  const unsigned = new Request(B + "/api/v1/me", { headers: { authorization: `Bearer ${t.access_token}` } });
  await assert.rejects(auth.bearerAuth(unsigned), /signed request required/);

  const nonce = randomBytes(16).toString("hex");
  await auth.bearerAuth(signed(k.priv, t.access_token, "GET", "/api/v1/me", "", { nonce }));
  await assert.rejects(auth.bearerAuth(signed(k.priv, t.access_token, "GET", "/api/v1/me", "", { nonce })), /replayed/);
  await assert.rejects(auth.bearerAuth(signed(k.priv, t.access_token, "GET", "/api/v1/me", "", { ts: Math.floor(Date.now() / 1000) - 120 })), /±60 s/);
  await assert.rejects(auth.bearerAuth(signed(k.priv, t.access_token, "POST", "/api/v1/x", '{"amount":1}', { bodySent: '{"amount":9}' })), /invalid request signature/);
  await assert.rejects(auth.bearerAuth(signed(k.priv, t.access_token, "GET", "/api/v1/me", "", { pathSent: "/api/v1/vault/key" })), /invalid request signature/);
  await assert.rejects(auth.bearerAuth(signed(keypair().priv, t.access_token, "GET", "/api/v1/me")), /invalid request signature/);

  // the same request object can be checked twice by a route (memoised, nonce used once)
  const req = signed(k.priv, t.access_token, "GET", "/api/v1/vault/key");
  assert.ok(await auth.bearerAuth(req));
  assert.ok(await auth.bearerAuth(req));
  // refresh tokens are not bearer tokens
  assert.equal(await auth.bearerAuth(signed(k.priv, t.refresh_token!, "GET", "/api/v1/me")), null);
});

test("refresh rotates both tokens; reusing an old refresh token signs the device out", async () => {
  const k = keypair();
  const t = await login(k.pub);
  const body = JSON.stringify({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  const unsignedRefresh = new Request(B + "/api/v1/device/token", { method: "POST", body });
  await assert.rejects(flow.refreshDeviceToken(unsignedRefresh, t.refresh_token!), /signed request required/);
  const r1 = await flow.refreshDeviceToken(signed(k.priv, "", "POST", "/api/v1/device/token", body), t.refresh_token!);
  assert.notEqual(r1.access_token, t.access_token);
  assert.notEqual(r1.refresh_token, t.refresh_token);
  assert.equal(await auth.bearerAuth(signed(k.priv, t.access_token, "GET", "/api/v1/me")), null, "old access token ended");
  assert.ok(await auth.bearerAuth(signed(k.priv, r1.access_token, "GET", "/api/v1/me")));
  // a thief replays the old refresh token (with a valid signature — worst case)
  await assert.rejects(flow.refreshDeviceToken(signed(k.priv, "", "POST", "/api/v1/device/token", body), t.refresh_token!), /reused/);
  assert.equal(await auth.bearerAuth(signed(k.priv, r1.access_token, "GET", "/api/v1/me")), null, "everything of the device revoked");
  assert.ok(await db.adminAudit.findFirst({ where: { action: "device.refresh-reuse" } }));
});

test("revoking the device stops its tokens at once", async () => {
  const k = keypair();
  const t = await login(k.pub);
  await flow.revokeDevice(userId, t.device_id);
  assert.equal(await auth.bearerAuth(signed(k.priv, t.access_token, "GET", "/api/v1/me")), null);
});

test("legacy devices keep working unsigned until the relay requires signatures", async () => {
  const t = await login();
  assert.equal(t.refresh_token, undefined);
  assert.equal(t.expires_in, 90 * 86400);
  const req = () => new Request(B + "/api/v1/llm/models", { headers: { authorization: `Bearer ${t.access_token}` } });
  const a = await auth.bearerAuth(req());
  assert.equal(a?.signed, false);
  assert.ok(await relay.llmAuth(req()));
  process.env.LLM_REQUIRE_SIGNATURE = "1";
  await assert.rejects(relay.llmAuth(req()), /only accepts signed requests/);
  delete process.env.LLM_REQUIRE_SIGNATURE;
  // nonces older than 10 minutes are purged
  await db.requestNonce.updateMany({ data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
  assert.ok((await sig.purgeNonces()) > 0);
});
