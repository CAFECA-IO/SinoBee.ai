import { before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { useTestDb } from "./helpers/testdb";

useTestDb();
const UNIFONT = "/usr/share/fonts/opentype/unifont/unifont.otf";

let db: typeof import("../src/lib/db").db;
let share: typeof import("../src/lib/crowd/share");
let route: typeof import("../src/app/api/crowd/[id]/og/route");
type U = Awaited<ReturnType<typeof import("../src/lib/db").db.user.create>>;
let ann: U, bob: U, cat: U;
const DAY = 86400_000;

before(async () => {
  ({ db } = await import("../src/lib/db"));
  share = await import("../src/lib/crowd/share");
  route = await import("../src/app/api/crowd/[id]/og/route");
  const mk = (n: string, h: string) => db.user.create({ data: { account: "0x" + n.repeat(40), handle: h } });
  [ann, bob, cat] = await Promise.all([mk("a", "ann"), mk("b", "bob"), mk("c", "cat")]);
});

async function campaign(extra: Record<string, unknown> = {}) {
  return db.task.create({
    data: {
      userId: ann.id,
      title: "台北市公車站無障礙設施調查",
      prompt: "# 台北市公車站無障礙設施調查\n\n整理公開資料",
      model: "anthropic/claude-sonnet-5-5",
      crowdfund: true,
      isPublic: true,
      status: "FUNDING",
      goalTwd: 1500,
      durationDays: 30,
      category: "research",
      deadlineAt: new Date(Date.now() + 4.5 * DAY),
      spec: { summary: "以政府開放資料盤點台北市所有公車站的無障礙坡道、導盲磚與候車亭設施，產出分區報表與改善建議清單，供市民與議員參考。".repeat(2), deliverables: ["report.md"], method: ["collect"], acceptance: ["covers every stop"], estimate: { p50Twd: 600, p90Twd: 1200 } },
      ...extra,
    },
  });
}

test("link preview text: title ≤ 60, description ≤ 160 with the goal and progress, both languages", async () => {
  const t = await campaign();
  await db.pledge.create({ data: { taskId: t.id, userId: bob.id, source: "CARD", shares: 20, amountTwd: 600 } });
  await db.pledge.create({ data: { taskId: t.id, userId: cat.id, source: "POINTS", shares: 5, amountTwd: 150 } });
  const zh = (await share.crowdShare(t.id, "zh-TW"))!;
  assert.equal(zh.percent, 50);
  assert.equal(zh.backers, 2);
  assert.equal(zh.daysLeft, 5);
  assert.equal(zh.stage, "open");
  assert.ok([...zh.title].length <= share.TITLE_MAX);
  assert.ok([...zh.description].length <= share.DESCRIPTION_MAX, `${[...zh.description].length}`);
  assert.match(zh.description, /^以政府開放資料.*… 目標 NT\$1,500，已達 50%，2 人出資，剩 5 天。每份 NT\$30，未達標不扣款。$/);
  assert.equal(zh.url, `http://localhost:3000/tasks/${t.id}`);
  assert.match(zh.imageUrl, new RegExp(`/api/crowd/${t.id}/og\\?l=zh-TW&v=[0-9a-f]{12}$`));
  const en = (await share.crowdShare(t.id, "en"))!;
  assert.match(en.description, /Goal NT\$1,500, 50% pledged by 2 backers, 5 days left\. NT\$30 a share; no charge unless funded\.$/);
  assert.equal(en.url, `http://localhost:3000/en/tasks/${t.id}`);
  assert.equal(en.category, "Research");

  // long titles are clipped with an ellipsis
  assert.equal(share.clip("a".repeat(70), 60).length, 60);
  assert.ok(share.clip("a".repeat(70), 60).endsWith("…"));
});

test("Open Graph and X card tags: 1200×630 picture with alt, canonical URL, locale; optional fb:app_id and twitter:site", async () => {
  const t = await campaign({ title: "Weather station map" });
  const m = (await share.crowdMetadata(t.id, "en"))!;
  const og = m.openGraph as { type: string; url: string; locale: string; siteName: string; images: { url: string; width: number; height: number; alt: string; type: string }[] };
  assert.equal(og.type, "website");
  assert.equal(og.siteName, "SinoBee.ai");
  assert.equal(og.locale, "en_US");
  assert.equal(og.images[0].width, 1200);
  assert.equal(og.images[0].height, 630);
  assert.equal(og.images[0].type, "image/png");
  assert.match(og.images[0].alt, /^Weather station map: a SinoBee crowdfund/);
  assert.equal((m.twitter as { card: string }).card, "summary_large_image");
  assert.equal((m.alternates as { canonical: string }).canonical, og.url);
  assert.equal(m.facebook, undefined);
  process.env.FACEBOOK_APP_ID = "123456";
  process.env.X_SITE = "SinoBeeAI";
  const m2 = (await share.crowdMetadata(t.id, "en"))!;
  assert.deepEqual(m2.facebook, { appId: "123456" });
  assert.equal((m2.twitter as { site: string }).site, "@SinoBeeAI");
  delete process.env.FACEBOOK_APP_ID;
  delete process.env.X_SITE;
});

test("the picture URL changes with what the picture shows, not with every pledge", async () => {
  const t = await campaign({ goalTwd: 3000 });
  const v0 = (await share.crowdShare(t.id, "zh-TW"))!.version;
  assert.equal((await share.crowdShare(t.id, "zh-TW"))!.version, v0, "stable");
  await db.pledge.create({ data: { taskId: t.id, userId: bob.id, source: "CARD", shares: 1, amountTwd: 30 } });
  const v1 = (await share.crowdShare(t.id, "zh-TW"))!.version;
  assert.notEqual(v1, v0, "a new backer");
  await db.pledge.create({ data: { taskId: t.id, userId: bob.id, source: "CARD", shares: 1, amountTwd: 30 } });
  assert.equal((await share.crowdShare(t.id, "zh-TW"))!.version, v1, "2% → 2%: same picture");
  await db.task.update({ where: { id: t.id }, data: { status: "QUEUED" } });
  const funded = (await share.crowdShare(t.id, "zh-TW"))!;
  assert.notEqual(funded.version, v1);
  assert.equal(funded.stageLabel, "募資成功・執行中");
  assert.equal(funded.daysLeft, null);
  assert.notEqual((await share.crowdShare(t.id, "en"))!.version, funded.version, "per language");
});

test("only public campaigns have previews", async () => {
  assert.equal(await share.crowdShare((await campaign({ isPublic: false })).id, "zh-TW"), null);
  assert.equal(await share.crowdShare((await campaign({ status: "DRAFT" })).id, "zh-TW"), null);
  assert.equal(await share.crowdShare((await campaign({ takenDownAt: new Date() })).id, "zh-TW"), null);
  assert.equal(await share.crowdShare("../../etc", "zh-TW"), null);
  const r = await route.GET(new Request("http://localhost/api/crowd/x/og"), { params: Promise.resolve({ id: (await campaign({ isPublic: false })).id }) });
  assert.equal(r.status, 404);
});

const pngSize = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset);
  return { sig: Buffer.from(b.subarray(1, 4)).toString(), w: v.getUint32(16), h: v.getUint32(20) };
};

test("the picture: a 1200×630 PNG under 1 MB; cached for a day at the current version", { skip: !existsSync(UNIFONT) && "no CJK test font" }, async () => {
  process.env.OG_FONT_PATH = UNIFONT;
  try {
    const t = await campaign();
    const s = (await share.crowdShare(t.id, "zh-TW"))!;
    const r = await route.GET(new Request(s.imageUrl), { params: Promise.resolve({ id: t.id }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.equal(r.headers.get("cache-control"), "public, max-age=86400");
    const b = new Uint8Array(await r.arrayBuffer());
    assert.deepEqual(pngSize(b), { sig: "PNG", w: 1200, h: 630 });
    assert.ok(b.length < 1_000_000, `${b.length} bytes`);
    const old = await route.GET(new Request(`http://localhost/api/crowd/${t.id}/og?l=zh-TW&v=000000000000`), { params: Promise.resolve({ id: t.id }) });
    assert.equal(old.headers.get("cache-control"), "public, max-age=300", "an old version is served briefly");
  } finally {
    delete process.env.OG_FONT_PATH;
  }
});

test("without a CJK font the site picture is used instead of a blank one; English renders with the built-in font", async () => {
  process.env.OG_FONT_URL = "http://127.0.0.1:1/css2?family=Noto+Sans+TC";
  try {
    const t = await campaign();
    const r = await route.GET(new Request(`http://localhost/api/crowd/${t.id}/og?l=zh-TW`), { params: Promise.resolve({ id: t.id }) });
    assert.equal(r.status, 302);
    assert.match(r.headers.get("location") ?? "", /\/screenshots\/usecase-research\.png$/);
    const e = await campaign({ title: "Bus stop survey", category: "data", spec: { summary: "Survey every bus stop from open data", deliverables: ["r"], method: ["m"], acceptance: ["a"], estimate: { p50Twd: 1, p90Twd: 2 } } });
    await db.user.update({ where: { id: ann.id }, data: { handle: "ann" } });
    const en = await route.GET(new Request(`http://localhost/api/crowd/${e.id}/og?l=en`), { params: Promise.resolve({ id: e.id }) });
    assert.equal(en.status, 200);
    assert.deepEqual(pngSize(new Uint8Array(await en.arrayBuffer())), { sig: "PNG", w: 1200, h: 630 });
  } finally {
    delete process.env.OG_FONT_URL;
  }
});
