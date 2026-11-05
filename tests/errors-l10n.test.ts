import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { HttpError, reqLang } from "../src/lib/errors";
import { handle } from "../src/lib/http";

/** Error messages follow the page language; API clients (no referer) keep English. */

const req = (headers: Record<string, string>) => new Request("http://x/api/t", { headers });

test("the reader's language comes from the referring page, then NEXT_LOCALE, else English", () => {
  assert.equal(reqLang(req({ referer: "https://sinobee.ai/admin?tab=models" })), "zh");
  assert.equal(reqLang(req({ referer: "https://sinobee.ai/en/admin" })), "en");
  assert.equal(reqLang(req({ cookie: "a=1; NEXT_LOCALE=zh-TW" })), "zh");
  assert.equal(reqLang(req({ cookie: "NEXT_LOCALE=en" })), "en");
  assert.equal(reqLang(req({})), "en");
  assert.equal(reqLang(undefined), "en");
});

test("handle() answers in the reader's language", async () => {
  const route = handle(async (_r: Request) => {
    throw new HttpError(400, { zh: "請填寫名稱", en: "name is required" });
  });
  const zh = await route(req({ referer: "https://sinobee.ai/admin" }));
  assert.equal(zh.status, 400);
  assert.deepEqual(await zh.json(), { error: "請填寫名稱" });
  assert.deepEqual(await (await route(req({ referer: "https://sinobee.ai/en/admin" }))).json(), { error: "name is required" });
  assert.deepEqual(await (await route(req({}))).json(), { error: "name is required" });
  // plain strings are passed through, and .message stays English for logs
  assert.equal(new HttpError(400, { zh: "甲", en: "a" }).message, "a");
});

test("validation errors name the field in Chinese for Chinese pages", async () => {
  const route = handle(async (_r: Request) => {
    z.object({ fee: z.number() }).parse({ fee: "x" });
    return new Response();
  });
  const j = await (await route(req({ referer: "https://sinobee.ai/admin" }))).json();
  assert.equal(j.error, "invalid_request");
  assert.equal(j.issues[0].message, "「fee」的值不正確");
  assert.ok(j.issues[0].detail);
  const en = await (await route(req({}))).json();
  assert.notEqual(en.issues[0].message, "「fee」的值不正確");
});
