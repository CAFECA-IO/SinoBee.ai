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
  assert.equal(f.name, "x.html");
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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const doc = (o: Record<string, unknown> = {}) => ({
  kind: "doc", entry: "report.md", title: "神經網路是什麼", description: "3Blue1Brown 用手寫數字拆解深度學習", visibility: "LINK", messages: [],
  files: [
    { name: "report.md", mime: "text/markdown", data: Buffer.from("# 標題\n\n![封面](cover.png)\n\n![圖](frames/t0915.jpg)\n\n[頁面](fig/page.html) $120^\\circ$").toString("base64") },
    { name: "cover.png", mime: "image/png", data: PNG.toString("base64") },
    { name: "frames/t0915.jpg", mime: "image/jpeg", data: Buffer.from("jpg").toString("base64") },
    { name: "fig/page.html", mime: "text/html", data: Buffer.from("<script>1</script>").toString("base64") },
    { name: "../../etc/passwd", mime: "text/plain", data: Buffer.from("x").toString("base64") },
  ],
  ...o,
});

test("document shares keep their folder layout, an entry, a description and a link-preview picture", async () => {
  const s = await sh.createShare(owner, doc(), [], PNG);
  assert.equal(s.kind, "doc");
  assert.equal(s.entry, "report.md");
  assert.equal(s.description, "3Blue1Brown 用手寫數字拆解深度學習");
  assert.equal(s.ogKey, `shares/${s.id}/og`);
  const { share } = await sh.loadShare(s.id, null);
  assert.deepEqual(share!.files.map((f) => [f.name, f.mime]), [
    ["report.md", "text/markdown"], ["cover.png", "image/png"], ["frames/t0915.jpg", "image/jpeg"], ["fig/page.html", "text/html"], ["etc/passwd", "text/plain"],
  ]);
  assert.deepEqual(await storage.getObject(s.ogKey!), PNG);
  const j = sh.shareJson(s, "https://sinobee.ai");
  assert.equal(j.thumbnail, `https://sinobee.ai/api/shares/${s.id}/og`);
  assert.equal(j.kind, "doc");
  // multipart uploads carry the bundle paths in fileNames
  const m = await sh.createShare(owner, { ...doc(), files: [], fileNames: ["report.md", "img/a.png"] },
    [{ name: "report.md", mime: "text/markdown", bytes: Buffer.from("# x") }, { name: "a.png", mime: "image/png", bytes: PNG }]);
  assert.deepEqual((await sh.loadShare(m.id, null)).share!.files.map((f) => f.name), ["report.md", "img/a.png"]);
});

test("document shares are checked: entry present, picture is an image, secrets in the page are refused", async () => {
  await assert.rejects(sh.createShare(owner, doc({ entry: "missing.md" })), /entry/);
  await assert.rejects(sh.createShare(owner, doc(), [], Buffer.from("<svg onload=alert(1)>")), /thumb/);
  await assert.rejects(sh.createShare(owner, doc({ files: [{ name: "report.md", mime: "text/markdown", data: Buffer.from("key sk-ant-" + "a".repeat(30)).toString("base64") }] })), /API key/);
  await assert.rejects(sh.createShare(owner, { ...doc(), kind: "chat" }), /at least one message/);
});

test("link previews only for live LINK and PUBLIC shares", async () => {
  const live = { visibility: "LINK", revokedAt: null, expiresAt: null };
  assert.ok(sh.previewable(live));
  assert.ok(sh.previewable({ ...live, visibility: "PUBLIC" }));
  assert.ok(!sh.previewable({ ...live, visibility: "LOGIN" }));
  assert.ok(!sh.previewable({ ...live, revokedAt: new Date() }));
  assert.ok(!sh.previewable({ ...live, expiresAt: new Date(Date.now() - 1000) }));
  assert.equal(sh.thumbMime(PNG), "image/png");
  assert.equal(sh.thumbMime(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(30)])), "image/jpeg");
  assert.equal(sh.thumbMime(Buffer.alloc(sh.MAX_THUMB_BYTES + 1, 0x89)), null);
  assert.equal(sh.safePath("../a/./b/../c.png"), "a/b/c.png");
  assert.equal(sh.safePath("/abs/.hidden/x"), "abs/_hidden/x");
});

test("view capabilities name one share and expire", async () => {
  const cap = await import("../src/lib/shares/view-cap");
  const c = cap.viewCap("abcdef123456");
  assert.ok(cap.checkCap("abcdef123456", c));
  assert.ok(!cap.checkCap("abcdef123457", c));
  assert.ok(!cap.checkCap("abcdef123456", c.slice(0, -1) + (c.endsWith("A") ? "B" : "A")));
  assert.ok(!cap.checkCap("abcdef123456", c, Date.now() + 15 * 3600_000));
  assert.ok(!cap.checkCap("abcdef123456", "zzzz.short"));
});

test("shared Markdown: relative images and documents point into the share, nothing climbs out", async () => {
  const { rebaseMarkdown, joinPath } = await import("../src/lib/shares/doc-paths");
  assert.equal(joinPath("doc1", "../x.png"), "x.png");
  assert.equal(joinPath("", "../x.png"), null);
  const names = new Set(["doc1/report.md", "doc1/cover.png", "doc1/frames/t 1.jpg", "doc1/fig/page.html", "secret.txt"]);
  const out = rebaseMarkdown("![c](cover.png) ![f](<frames/t 1.jpg>) [p](fig/page.html) [s](../../secret.txt) [w](https://x.y) ![m](missing.png)",
    "doc1/report.md", names, "abcdef123456", "CAP", (p) => `/s/abcdef123456/v/${p}`);
  assert.equal(out, "![c](</api/shares/abcdef123456/raw/CAP/doc1/cover.png>) ![f](</api/shares/abcdef123456/raw/CAP/doc1/frames/t%201.jpg>) " +
    "[p](</s/abcdef123456/v/doc1/fig/page.html>) [s](../../secret.txt) [w](https://x.y) ![m](missing.png)");
});

test("mermaid labels the lexer rejects are quoted; money is not math", async () => {
  const { mmdFix } = await import("../src/lib/mermaid-fix");
  assert.equal(mmdFix("quadrantChart\n  x-axis 低 (長) --> 高 (短)\n  quadrant-1 好 (a)\n  點 (B58): [0.1, 0.9]"),
    'quadrantChart\n  x-axis "低 (長)" --> "高 (短)"\n  quadrant-1 "好 (a)"\n  "點 (B58)": [0.1, 0.9]');
  assert.equal(mmdFix("flowchart LR\n  A[引擎 (V6)] -->|好 (x)| B{V6/V8?}"), 'flowchart LR\n  A["引擎 (V6)"] -->|"好 (x)"| B{"V6/V8?"}');
  const { escapeMoney } = await import("../src/lib/markdown-money");
  assert.equal(escapeMoney("NT$500 與 US$5，`a$1` 角度 $120^\\circ$"), "NT\\$500 與 US\\$5，`a$1` 角度 $120^\\circ$");
});

test("shared pages that write formulas without a math library get KaTeX", async () => {
  const { withMath } = await import("../src/lib/shares/math-page");
  const page = withMath("<html><head></head><body><p>速度 $v_e$</p></body></html>", "https://sinobee.ai");
  assert.ok(page && page.includes("katex.min.js") && page.includes("https://sinobee.ai/vendor/sb-math.js") && page.indexOf("katex") < page.indexOf("</head>"));
  assert.equal(withMath("<p>價格 $5 and $10</p>", "https://sinobee.ai"), null);
  assert.equal(withMath("<script src=katex.js></script><p>$x$</p>", "https://sinobee.ai"), null);
  assert.ok(withMath("<div class='formula'>F = ma</div>", "https://sinobee.ai"));
});
