import { before, test } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "./helpers/testdb";

useTestDb();

let db: typeof import("../src/lib/db").db;
let cl: typeof import("../src/lib/crowd/checklist");
let legal: typeof import("../src/lib/legal-versions");
let admin: Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;

before(async () => {
  ({ db } = await import("../src/lib/db"));
  cl = await import("../src/lib/crowd/checklist");
  legal = await import("../src/lib/legal-versions");
  admin = await db.user.create({ data: { account: "0x" + "e".repeat(40), handle: "admin", role: "ADMIN", isAdmin: true } });
});

test("the default checklist: at least 100 yes/no items in six dimensions, unique ids, both languages", async () => {
  const c = await cl.currentChecklist();
  assert.equal(c.version, 1);
  assert.ok(c.items.length >= 100, `${c.items.length} items`);
  assert.deepEqual([...new Set(c.items.map((i) => i.dimension))].sort(), [...cl.DIMENSIONS].sort());
  for (const d of cl.DIMENSIONS) assert.ok(c.items.filter((i) => i.dimension === d).length >= 15, `${d} has at least 15 items`);
  assert.equal(new Set(c.items.map((i) => i.id)).size, c.items.length);
  for (const i of c.items) assert.ok(i.zh.length > 5 && i.en.length > 10, i.id);
  assert.deepEqual(cl.checklistProblems(c.items), []);
});

test("draft: manual edits get ids, publishing needs 100 items and all dimensions, versions are kept", async () => {
  const cur = await cl.currentChecklist();
  const removed = cur.items.slice(0, 6); // L01–L06
  await cl.saveDraft(admin.id, cur.items.slice(6));
  await assert.rejects(cl.publishDraft(admin.id, "trim"), /at least 100 items/);
  await assert.rejects(cl.saveDraft(admin.id, [...cur.items, { dimension: "nope", zh: "x", en: "y" }]), /unknown dimension/);
  await assert.rejects(cl.saveDraft(admin.id, [...cur.items, { dimension: "legal", zh: "只有中文" }]), /both the Chinese and the English/);
  const items = await cl.saveDraft(admin.id, [...cur.items, { dimension: "safety", zh: "任務不提供醫療診斷。", en: "The task gives no medical diagnosis." }]);
  const added = items.at(-1)!;
  assert.equal(added.id, "S19", "next free number in the dimension");
  assert.equal((await cl.draftChecklist()).changed, true);
  await assert.rejects(cl.publishDraft(admin.id, "  "), /describe what changed/);
  const r = await cl.publishDraft(admin.id, "Add a medical diagnosis item");
  assert.equal(r.version, 2);
  const now = await cl.currentChecklist();
  assert.equal(now.version, 2);
  assert.equal(now.items.length, cur.items.length + 1);
  assert.equal((await cl.checklistVersion(1))!.items.length, cur.items.length, "version 1 unchanged");
  assert.equal((await cl.draftChecklist()).changed, false, "no draft after publishing");
  assert.ok(await db.adminAudit.findFirst({ where: { action: "crowd.checklist.publish" } }));
  await assert.rejects(cl.publishDraft(admin.id, "again"), /no draft/);
  // the draft starts from the published version and can be thrown away
  await cl.saveDraft(admin.id, now.items.filter((i) => !removed.some((x) => x.id === i.id)));
  await cl.discardDraft();
  assert.equal((await cl.draftChecklist()).items.length, now.items.length);
});

test("development stand-in for AI edits leaves the draft unchanged", async () => {
  const r = await cl.editDraftWithAi(admin.id, "add an item about elections");
  assert.match(r.reply, /development stand-in/);
  assert.equal(r.items.length, (await cl.currentChecklist()).items.length);
});

test("legal texts: versioned markdown, crowdfunding terms list every item of the current checklist", async () => {
  const rows = await legal.snapshotAllLegal();
  assert.equal(rows.length, 8, "4 documents × 2 languages");
  const crowd = rows.find((r) => r.doc === "crowd" && r.locale === "zh-TW")!;
  const c = await cl.currentChecklist();
  for (const i of c.items) assert.ok(crowd.markdown.includes(`**${i.id}** ${i.zh}`), `${i.id} listed`);
  assert.match(crowd.markdown, new RegExp(`第 ${c.version} 版`));
  assert.match(crowd.markdown, new RegExp(`全部 ${c.items.length} 題都符合才會開放出資`));
  const en = rows.find((r) => r.doc === "crowd" && r.locale === "en")!;
  assert.ok(en.markdown.includes(`**${c.items[0].id}** ${c.items[0].en}`));
  assert.match(crowd.sha256, /^[0-9a-f]{64}$/);
  // the same text is not recorded twice; a change makes a new version
  const again = await legal.snapshotLegal("crowd", "zh-TW");
  assert.equal(again.id, crowd.id);
  await cl.saveDraft(admin.id, [...c.items, { dimension: "spec", zh: "提案標題不含表情符號。", en: "The proposal title contains no emoji." }]);
  await cl.publishDraft(admin.id, "emoji rule");
  const v2 = await legal.snapshotLegal("crowd", "zh-TW");
  assert.equal(v2.version, crowd.version + 1);
  assert.ok(v2.markdown.includes("提案標題不含表情符號"));
  // terms reference the crowdfunding terms
  const terms = rows.find((r) => r.doc === "terms" && r.locale === "zh-TW")!;
  assert.match(terms.markdown, /\(\/crowd-terms\)/);
});

test("with Boltchain on, every new legal version is queued for notarization (sha-256 of the exact markdown)", async () => {
  process.env.BOLT_RPC_URL = "http://127.0.0.1:1";
  process.env.BOLT_WALLET_KEY = "0x" + "1".repeat(64);
  process.env.BOLT_MASTER_KEY = "2".repeat(64);
  process.env.BOLT_CERTIFICATES = "0x" + "3".repeat(40);
  try {
    const v = await legal.snapshotLegal("privacy", "en");
    const a = await db.anchor.findUnique({ where: { targetType_targetId: { targetType: "legal", targetId: v.id } } });
    assert.ok(a, "anchor queued");
    const files = a!.files as { sha256: string; size: number }[];
    assert.equal(files[0].sha256, `0x${v.sha256}`);
    assert.equal(files[0].size, Buffer.byteLength(v.markdown, "utf8"));
    assert.deepEqual(await legal.legalCertificate(v.id), { code: null, pending: true });
    await db.legalVersion.update({ where: { id: v.id }, data: { anchorCode: "ABCDEFGHJKMNPQRS" } });
    assert.deepEqual(await legal.legalCertificate(v.id), { code: "ABCDEFGHJKMNPQRS", pending: false });
  } finally {
    for (const k of ["BOLT_RPC_URL", "BOLT_WALLET_KEY", "BOLT_MASTER_KEY", "BOLT_CERTIFICATES"]) delete process.env[k];
  }
});
