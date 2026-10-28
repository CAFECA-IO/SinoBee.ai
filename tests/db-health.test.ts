import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// an unreachable PostgreSQL: nothing listens on port 1
process.env.DATABASE_URL = "postgresql://sinobee:secret@127.0.0.1:1/sinobee";
process.env.SECRETS_KEY = randomBytes(32).toString("hex");

test("an unreachable database is recognized; the fallback is used and the outage recorded without credentials", async () => {
  const { db } = await import("../src/lib/db");
  const h = await import("../src/lib/db-health");
  const err = await db.skill.count().then(() => null, (e: unknown) => e);
  assert.ok(err, "the query fails");
  assert.ok(h.isDbDown(err), `classified as down: ${String((err as Error).message)}`);

  const r = await h.withDbFallback(() => db.skill.count(), null);
  assert.deepEqual(r, { value: null, dbDown: true });
  assert.equal(await h.dbAvailable(), false);
  const o = h.dbOutage();
  assert.equal(o.kind, "postgres");
  assert.equal(o.target, "127.0.0.1:1/sinobee");
  assert.ok(o.since);
  assert.match(String(o.code), /DatabaseNotReachable/);
  assert.ok(!JSON.stringify(o).includes("secret"), "no password");
  await db.$disconnect().catch(() => undefined);
});

test("other errors are not mistaken for an outage and still throw", async () => {
  const h = await import("../src/lib/db-health");
  assert.equal(h.isDbDown(new Error("Unique constraint failed")), false);
  assert.equal(h.isDbDown({ code: "P2002" }), false);
  assert.equal(h.isDbDown({ code: "P1017" }), true);
  assert.equal(h.isDbDown({ meta: { driverAdapterError: { message: "ConnectionClosed" } } }), true);
  assert.equal(h.isDbDown({ code: "P2010", meta: { driverAdapterError: { cause: { kind: "DatabaseNotReachable" } } } }), true);
  assert.equal(h.isDbDown({ code: "P2010", meta: { driverAdapterError: { cause: { kind: "UniqueConstraintViolation" } } } }), false);
  await assert.rejects(h.withDbFallback(async () => { throw new Error("bug"); }, null), /bug/);
});

test("the role hint marks admins only, expires, and cannot be forged", async () => {
  const { roleHintValue, isAdminHint } = await import("../src/lib/role-hint");
  const admin = roleHintValue("u1", "ADMIN").value;
  assert.equal(isAdminHint(admin), true);
  assert.equal(isAdminHint(roleHintValue("u1", "SUPERADMIN").value), true);
  assert.equal(isAdminHint(roleHintValue("u2", "USER").value), false);
  const [uid, , exp, sig] = admin.split(".");
  assert.equal(isAdminHint(`${uid}.A.${Number(exp) + 1}.${sig}`), false, "tampered expiry");
  assert.equal(isAdminHint(roleHintValue("u2", "USER").value.replace(".U.", ".A.")), false, "tampered role");
  assert.equal(isAdminHint(undefined), false);
  assert.equal(isAdminHint("garbage"), false);
});
