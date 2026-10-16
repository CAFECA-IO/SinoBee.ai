import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalRpc, siteAddress } from "../scripts/boltchain-node";

test("local RPC detection and site wallet address", () => {
  assert.ok(siteAddress("0x" + "1".repeat(64))?.startsWith("0x"));
  assert.equal(siteAddress("nope"), null);
  assert.equal(isLocalRpc("http://127.0.0.1:8545"), true);
  assert.equal(isLocalRpc("https://rpc.example.com"), false);
});
