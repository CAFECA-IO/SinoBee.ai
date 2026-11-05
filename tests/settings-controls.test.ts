import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { SETTINGS, GROUPS } from "../src/lib/settings/registry";
import { CONTROLS, UI, checkValue, controlOf, fromShown, isDanger, joinPairs, parsePairs, toShown } from "../src/lib/settings/ui";

/**
 * Admin settings rework (design: 操作元件): every setting is edited with one of the 16 controls and declares what that
 * control needs. A setting that does not, or a settings screen that brings its own input, fails here.
 */

test("every setting is edited with one of the 16 controls and declares what the control needs", () => {
  const problems: string[] = [];
  for (const d of SETTINGS) {
    const c = controlOf(d);
    const u = d.ui ?? {};
    if (!(CONTROLS as readonly string[]).includes(c)) problems.push(`${d.key}: unknown control ${c}`);
    if (c === "number" || c === "percent" || c === "money") {
      if (!u.unit) problems.push(`${d.key}: ${c} needs a unit`);
      if (!u.big && (u.min === undefined || u.max === undefined)) problems.push(`${d.key}: ${c} needs a range (min and max)`);
    }
    if (c === "percent" && !u.scale) problems.push(`${d.key}: percent needs its scale`);
    if (c === "segmented" || c === "select" || c === "cards" || c === "chips")
      for (const o of d.options ?? []) if (!u.options?.[o]?.label.zh) problems.push(`${d.key}: option ${o} needs a name`);
    if (c === "cards") for (const o of d.options ?? []) if (!u.options?.[o]?.body?.zh) problems.push(`${d.key}: card ${o} needs to say what it does`);
    if (c === "list" && !u.item) problems.push(`${d.key}: a list needs the form of one item`);
    if (c === "pairs" && !u.pairs) problems.push(`${d.key}: pairs needs its two columns`);
    if (d.generate && !u.danger) problems.push(`${d.key}: a generated key needs the consequence of replacing it`);
    if (u.dangerWhen) for (const v of u.dangerWhen) if (d.type === "select" && !d.options?.includes(v)) problems.push(`${d.key}: dangerWhen ${v} is not an option`);
    if (d.type === "number" && c !== "number" && c !== "percent" && c !== "money") problems.push(`${d.key}: a number shown as ${c}`);
  }
  for (const k of Object.keys(UI)) if (!SETTINGS.some((d) => d.key === k)) problems.push(`UI declares ${k}, which is not a setting`);
  assert.deepEqual(problems, []);
});

test("settings screens use only the controls kit (no inputs of their own) and every group is shown", () => {
  const screens = ["src/components/admin-site-settings.tsx", "src/components/admin-connector.tsx", "src/app/[locale]/admin/_sections/services.tsx", "src/app/[locale]/admin/_sections/health.tsx", "src/components/admin-health.tsx"];
  for (const f of screens) {
    const src = readFileSync(f, "utf8");
    for (const tag of ["<input", "<select", "<textarea"]) assert.ok(!src.includes(tag), `${f} uses ${tag}; use src/components/settings-controls.tsx`);
  }
  const page = readFileSync("src/app/[locale]/admin/_sections/settings.tsx", "utf8");
  assert.ok(page.includes("SETTING_GROUPS") && !/const GROUPS = \[\s*"site"/.test(page), "the settings page takes its groups from the registry");
  for (const g of GROUPS) assert.ok(SETTINGS.some((d) => d.group === g), `group ${g} has settings`);
  // the controls file is the only place allowed to render raw inputs among the settings components
  const kit = readdirSync("src/components").filter((f) => /^settings-/.test(f));
  assert.deepEqual(kit, ["settings-controls.tsx"]);
  assert.ok(path.basename(screens[0]) === "admin-site-settings.tsx");
});

test("values are checked the same way for the browser and the server, with a message that says how to fix it", () => {
  const S = Object.fromEntries(SETTINGS.map((d) => [d.key, d]));
  // percent: typed 50 → stored 0.5; 150% is refused
  assert.equal(fromShown(S["crowd.approveShare"], "50"), "0.5");
  assert.equal(toShown(S["crowd.approveShare"], "0.5"), "50");
  const over = checkValue(S["crowd.approveShare"], "1.5");
  assert.ok(!over.ok && /最多 100%/.test(over.error.zh), JSON.stringify(over));
  // range and whole numbers
  assert.ok(!checkValue(S["llm.rpm"], "0").ok);
  assert.ok(!checkValue(S["llm.rpm"], "1.5").ok);
  assert.deepEqual(checkValue(S["llm.rpm"], "120"), { ok: true, value: "120" });
  // wei: whole numbers only, no 1e19
  assert.ok(!checkValue(S["boltchain.lowBalanceWei"], "1e19").ok);
  assert.equal((checkValue(S["boltchain.lowBalanceWei"], "10000000000000000000") as { value: string }).value, "10000000000000000000");
  // pairs: rows ↔ "7:0,30:0.03"; a bad row is refused instead of dropped
  const fee = S["crowd.feeRates"];
  assert.deepEqual(parsePairs(fee, "7:0,30:0.03"), [{ left: "7", right: "0" }, { left: "30", right: "3" }]);
  assert.equal(joinPairs(fee, [{ left: "7", right: "0" }, { left: "30", right: "3" }]), "7:0,30:0.03");
  assert.ok(!checkValue(fee, "30:3%").ok);
  // lists: each item checked
  const bad = checkValue(S["admins.initial"], `0x${"a".repeat(40)},0x123`);
  assert.ok(!bad.ok && bad.error.zh.includes("0x123"));
  // options by their names
  assert.ok(!checkValue(S["oen.env"], "staging").ok);
  // danger only for the values that are
  assert.equal(isDanger(S["oen.env"], "production"), true);
  assert.equal(isDanger(S["oen.env"], "testing"), false);
  assert.equal(isDanger(S["storage.driver"], "s3"), true);
});
