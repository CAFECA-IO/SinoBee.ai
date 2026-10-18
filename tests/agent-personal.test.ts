import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "./helpers/testdb";

useTestDb();

test("線上使用: the site's ticket and the gateway's cookie are signed, typed and expire", async () => {
  const a = await import("../src/lib/agent/personal");
  const t = a.signAgentToken("ticket", "cmvdi7khx0000cu7dusnzgjf0", 60);
  assert.equal(a.verifyAgentToken("ticket", t), "cmvdi7khx0000cu7dusnzgjf0");
  assert.equal(a.verifyAgentToken("session", t), null, "a ticket is not a session");
  assert.equal(a.verifyAgentToken("ticket", t.replace("cmvdi7khx", "cmvdi7khy")), null, "another user");
  assert.equal(a.verifyAgentToken("ticket", t.slice(0, -2) + "xx"), null, "forged mac");
  assert.equal(a.verifyAgentToken("ticket", a.signAgentToken("ticket", "cmvdi7khx0000cu7dusnzgjf0", -1)), null, "expired");
  assert.equal(a.verifyAgentToken("ticket", undefined), null);
  process.env.AGENT_ORIGIN = "https://agent.sinobee.ai/";
  assert.match(a.enterUrl("cmvdi7khx0000cu7dusnzgjf0"), /^https:\/\/agent\.sinobee\.ai\/__sb\/enter\?ticket=ticket\.cmvdi7khx0000cu7dusnzgjf0\.\d+\./);
  delete process.env.AGENT_ORIGIN;
});
