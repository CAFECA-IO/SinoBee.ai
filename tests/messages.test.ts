import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OFFICIAL } from "../src/lib/skills/official";

test("every official skill has a title and description in both languages", () => {
  for (const loc of ["zh-TW", "en"]) {
    const m = JSON.parse(readFileSync(`src/messages/${loc}.json`, "utf8")) as { skills: { official: Record<string, { title?: string; body?: string }> } };
    for (const name of OFFICIAL) {
      assert.ok(m.skills.official[name]?.title, `${loc}: skills.official.${name}.title`);
      assert.ok(m.skills.official[name]?.body, `${loc}: skills.official.${name}.body`);
    }
  }
});
