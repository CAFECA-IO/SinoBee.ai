import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { boltchainEnv, ensureEnvValues, isLocalRpc, siteAddress } from "../scripts/boltchain-node";

test(".env: missing or empty BOLT_* values are filled once, existing ones are kept", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "swarm-"));
  writeFileSync(path.join(dir, ".env"), "# my settings\nDATABASE_URL=\nBOLT_RPC_URL=\nBOLT_CERTIFICATES=0xabc\n");
  for (const k of Object.keys(process.env)) if (k.startsWith("BOLT_")) delete process.env[k];
  const env = boltchainEnv(dir, 8545, () => {});
  const text = readFileSync(path.join(dir, ".env"), "utf8");
  assert.match(text, /^# my settings$/m);
  assert.match(text, /^BOLT_RPC_URL=http:\/\/127\.0\.0\.1:8545$/m);
  assert.match(text, /^BOLT_CERTIFICATES=0xabc$/m, "existing value kept");
  assert.match(env.BOLT_WALLET_KEY, /^0x[0-9a-f]{64}$/);
  assert.match(env.BOLT_MASTER_KEY, /^[0-9a-f]{64}$/);
  assert.equal(statSync(path.join(dir, ".env")).mode & 0o777, 0o600);
  const again = boltchainEnv(dir, 9999, () => {});
  assert.equal(again.BOLT_WALLET_KEY, env.BOLT_WALLET_KEY, "the site wallet is created once");
  assert.equal(again.BOLT_RPC_URL, "http://127.0.0.1:8545");
  assert.deepEqual(ensureEnvValues(path.join(dir, ".env"), { BOLT_RPC_URL: "x" }), []);
  assert.ok(siteAddress(env.BOLT_WALLET_KEY)?.startsWith("0x"));
  assert.equal(isLocalRpc("http://127.0.0.1:8545"), true);
  assert.equal(isLocalRpc("https://rpc.example.com"), false);
});
