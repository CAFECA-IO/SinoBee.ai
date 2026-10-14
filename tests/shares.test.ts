import { before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { useTestDb } from "./helpers/testdb";

const { dir } = useTestDb();
process.env.STORAGE_LOCAL_DIR = path.join(dir, "storage");
let db: typeof import("../src/lib/db").db;
let sh: typeof import("../src/lib/shares/service");
let storage: typeof import("../src/lib/storage");
type U = Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;
let owner: U, carol: U, dave: U, admin: U;

const body = (o: Record<string, unknown> = {}) => ({
  title: "DB 分析", visibility: "LINK", model: "anthropic/claude",
  messages: [{ role: "user", text: "前五大客戶？" }, { role: "assistant", text: "![chart](files/1)\n\n```mermaid\ngraph TD;A-->B\n```", tools: [{ name: "db_query", input: "select …", output: "| a |" }] }],
  files: [{ name: "chart.png", mime: "image/png", data: Buffer.from("png-bytes").toString("base64") }],
  redactions: [{ kind: "dsn", count: 1 }],
  ...o,
});

before(async () => {
  ({ db } = await import("../src/lib/db"));
  sh = await import("../src/lib/shares/service");
  storage = await import("../src/lib/storage");
  owner = await db.user.create({ data: { account: "0x" + "a".repeat(40), handle: "owner" } });
  carol = await db.user.create({ data: { account: "0x" + "c".repeat(40), handle: "carol" } });
  dave = await db.user.create({ data: { account: "0x" + "d".repeat(40), handle: "dave" } });
  admin = await db.user.create({ data: { account: "0x" + "e".repeat(40), isAdmin: true } });
});

test("LINK shares: anyone with the link; stored doc and files round-trip", async () => {
  const s = await sh.createShare(owner, body());
  assert.match(s.id, /^[A-Za-z0-9]{12}$/);
  const { share, access } = await sh.loadShare(s.id, null);
  assert.ok(access.ok);
  const doc = await sh.readDoc(share!.objectKey);
  assert.equal(doc.messages.length, 2);
  assert.deepEqual(doc.files, [{ id: "1", name: "chart.png", mime: "image/png", size: 9 }]);
  assert.equal((await storage.getObject(share!.files[0].objectKey)).toString(), "png-bytes");
});

test("LOGIN shares limited to specific CAFECA accounts (decision 2)", async () => {
  const s = await sh.createShare(owner, body({ visibility: "LOGIN", accounts: ["@carol", "0x" + "B".repeat(40)] }));
  const access = async (u: U | null) => (await sh.loadShare(s.id, u)).access;
  assert.deepEqual(await access(null), { ok: false, status: 401, reason: "login" });
  assert.ok((await access(carol)).ok);
  assert.deepEqual(await access(dave), { ok: false, status: 403, reason: "not_allowed" });
  assert.ok((await access(owner)).ok);
  assert.ok((await access(admin)).ok);
  const rows = await db.shareAccess.findMany({ where: { shareId: s.id } });
  assert.deepEqual(rows.map((r) => r.account).sort(), ["0x" + "b".repeat(40), carol.account].sort());
  await assert.rejects(sh.createShare(owner, body({ visibility: "LOGIN", accounts: ["@nobody"] })), /unknown CAFECA account/);
  await assert.rejects(sh.createShare(owner, body({ visibility: "LINK", accounts: ["@carol"] })), /only apply to LOGIN/);
  // widen to any signed-in user, then narrow to dave only
  await sh.updateShare(s.id, owner, { visibility: "LOGIN", accounts: [] });
  assert.ok((await access(dave)).ok);
  await sh.updateShare(s.id, owner, { accounts: ["@dave"] });
  assert.ok((await access(dave)).ok);
  assert.equal((await access(carol)).ok, false);
  await assert.rejects(sh.updateShare(s.id, carol, { visibility: "PUBLIC" }), /not found/);
});

test("expiry and revoke (crypto-shred of every object)", async () => {
  const s = await sh.createShare(owner, body({ expiresInDays: 1 }));
  await db.conversationShare.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.deepEqual((await sh.loadShare(s.id, carol)).access, { ok: false, status: 410, reason: "expired" });
  const t = await sh.createShare(owner, body());
  await assert.rejects(sh.revokeShare(t.id, carol), /not found/);
  await sh.revokeShare(t.id, owner);
  assert.deepEqual((await sh.loadShare(t.id, null)).access, { ok: false, status: 410, reason: "revoked" });
  await assert.rejects(storage.getObject(t.objectKey));
});

test("size and shape limits", async () => {
  await assert.rejects(sh.createShare(owner, body({ files: [] }), [{ name: "big.bin", mime: "application/octet-stream", bytes: Buffer.alloc(26 * 1024 * 1024) }]), /larger than 25 MB/);
  const many = Array.from({ length: 5 }, (_, i) => ({ name: `p${i}.bin`, mime: "application/octet-stream", bytes: Buffer.alloc(21 * 1024 * 1024) }));
  await assert.rejects(sh.createShare(owner, body({ files: [] }), many), /attachments too large/);
  const vid = await sh.createShare(owner, body({ files: [] }), [{ name: "clip.mp4", mime: "video/mp4", bytes: Buffer.alloc(3 * 1024 * 1024) }]);
  assert.equal((await db.shareFile.findFirstOrThrow({ where: { shareId: vid.id } })).mime, "video/mp4");
  await assert.rejects(sh.createShare(owner, body({ messages: [] })));
  const s = await sh.createShare(owner, body({ files: [{ name: "../../x.html", mime: "text/html", data: "PGgxPg==" }] }));
  const f = (await db.shareFile.findMany({ where: { shareId: s.id } }))[0];
  assert.equal(f.mime, "application/octet-stream", "active content is never served as such");
  assert.equal(f.name, ".._.._x.html");
});

test("default 30-day expiry, never-expiring on request, and the server-side secret scan", async () => {
  const s = await sh.createShare(owner, body());
  const days = (s.expiresAt!.getTime() - Date.now()) / 86400_000;
  assert.ok(days > 29.9 && days <= 30);
  assert.equal((await sh.createShare(owner, body({ expiresInDays: null }))).expiresAt, null);
  await assert.rejects(sh.createShare(owner, body({ messages: [{ role: "user", text: "key sk-ant-abcdefghijklmnopqrstuvwxyz012345" }] })), /API key/);
  await assert.rejects(sh.createShare(owner, body({ messages: [{ role: "user", text: "postgres://demo:hunter22@db/shop" }] })), /connection string/);
  await sh.createShare(owner, body({ messages: [{ role: "user", text: "postgres://demo:••••@db/shop" }] }));
  const sk = await sh.createShare(owner, body({ skills: ["sales-report"] }));
  assert.deepEqual((await sh.readDoc(sk.objectKey)).skills, ["sales-report"]);
});
