import { config } from "@/lib/config";
import { settingsHealth } from "@/lib/admin-overview";
import { pricingSettings, pricesAt } from "@/lib/models";
import { pausedVendors } from "@/lib/llm/pause";
import { VENDORS } from "@/lib/llm/vendors";
import { listPlans } from "@/lib/plans";
import { planEconomics } from "@/lib/admin/plan-economics";
import { pendingRestart } from "@/lib/settings/store";
import { SETTING } from "@/lib/settings/registry";
import { modelProblems } from "./warnings";

/** ● normal · ▲ attention · ■ failing · ○ not set up — the four states of the design */
export type Level = "ok" | "warn" | "bad" | "off";

/**
 * One thing to look at on 站台健康: what happens (title, with i18n values), where it is (a settings key or a
 * page), and the link that opens the place to fix it.
 */
export type HealthIssue = {
  id: string;
  level: Exclude<Level, "ok" | "off">;
  /** admin.health.issue.<kind> with values, or a go-live check (admin.ov.check.<id>) */
  kind: string;
  values?: Record<string, string | number>;
  /** the setting to open, when it is one */
  setting?: string;
  href: string;
};

export type Service = { id: string; name: string; level: Level; line: { key: string; values?: Record<string, string | number> }; href: string };

/** Everything 站台健康 shows, computed on the server (the vendor checks reuse the model warnings) */
export async function siteHealth() {
  const [checks, models, paused, plans, { buffer }, prices] = await Promise.all([Promise.resolve(settingsHealth()), modelProblems(), pausedVendors(), listPlans({ activeOnly: true }), pricingSettings(), pricesAt(new Date())]);
  const issues: HealthIssue[] = [];
  for (const c of checks.filter((c) => !c.ok))
    issues.push({ id: `check:${c.id}`, level: c.level === "error" ? "bad" : "warn", kind: `check.${c.id}`, setting: c.keys[0], href: c.keys[0] ? `/admin?tab=settings&setting=${c.keys[0]}` : `/admin?tab=settings&group=${c.group}` });
  const byVendor = (list: { modelId: string }[]) => [...new Set(list.map((m) => m.modelId.split("/")[0]))];
  for (const v of byVendor(models.badKey)) issues.push({ id: `badKey:${v}`, level: "bad", kind: "badKey", values: { vendor: VENDORS.find((x) => x.id === v)?.name ?? v, n: models.badKey.filter((m) => m.modelId.startsWith(`${v}/`)).length }, setting: `apiKeys.${v}`, href: `/admin?tab=settings&setting=apiKeys.${v}` });
  for (const v of byVendor(models.noKey)) issues.push({ id: `noKey:${v}`, level: "bad", kind: "noKey", values: { vendor: VENDORS.find((x) => x.id === v)?.name ?? v, n: models.noKey.filter((m) => m.modelId.startsWith(`${v}/`)).length }, setting: `apiKeys.${v}`, href: `/admin?tab=settings&setting=apiKeys.${v}` });
  if (models.unknown.length) issues.push({ id: "unknown", level: "bad", kind: "unknown", values: { n: models.unknown.length, models: models.unknown.map((m) => m.modelId).join(", ") }, href: `/admin?tab=models&model=${encodeURIComponent(models.unknown[0].modelId)}` });
  for (const v of byVendor(models.unserved)) issues.push({ id: `unserved:${v}`, level: "bad", kind: v === "ollama" ? "ollamaDown" : "unserved", values: { n: models.unserved.filter((m) => m.modelId.startsWith(`${v}/`)).length }, href: `/admin?tab=models#vendor-${v}` });
  for (const w of models.whenResumed) issues.push({ id: `resume:${w.vendor}`, level: "warn", kind: w.why === "noKey" ? "resumeNoKey" : "resumeBadKey", values: { vendor: VENDORS.find((x) => x.id === w.vendor)?.name ?? w.vendor }, setting: `apiKeys.${w.vendor}`, href: `/admin?tab=settings&setting=apiKeys.${w.vendor}` });
  const econ = await Promise.all(plans.map((p) => planEconomics(p, buffer)));
  const losing = econ.filter((e) => e.margin !== null && e.margin < 1).length;
  if (losing) issues.push({ id: "plans", level: "warn", kind: "plansLoss", values: { n: losing }, href: "/admin?tab=plans" });
  // a vendor that reached its daily spend cap: its models stop until 08:00 Taiwan time (audit 1-6)
  const { providerSpendToday } = await import("@/lib/llm/quota");
  for (const v of VENDORS.filter((x) => config.llm.providers[x.id]?.key && config.llm.dailyLimit(x.id) > 0)) {
    const sp = await providerSpendToday(v.id);
    if (sp.reached) issues.push({ id: `dailyCap:${v.id}`, level: "bad", kind: "dailyCap", values: { vendor: v.name, spent: Math.round(sp.spent), limit: sp.limit }, setting: "llm.dailyLimitTwd", href: `/admin?tab=services&id=${v.id}` });
  }
  let waiting = 0;
  let hub: { linked: number; error: string | null } = { linked: 0, error: null };
  if (config.llm.providers.locutus?.key) {
    const { locutusOverview } = await import("@/lib/locutus/admin");
    const o = await locutusOverview().catch(() => null);
    if (o) {
      waiting = o.pending.length;
      hub = { linked: o.nodes.filter((n) => n.linked).length, error: o.hubError };
      if (waiting) issues.push({ id: "locutusWaiting", level: "warn", kind: "locutusWaiting", values: { n: waiting }, href: "/admin?tab=models#vendor-locutus" });
      if (o.hubError) issues.push({ id: "locutusHub", level: "bad", kind: "locutusHub", values: { error: o.hubError }, href: "/admin?tab=models#vendor-locutus" });
    }
  }
  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));

  // services: one tile each, the same four states
  const offered = (v: string) => prices.filter((m) => m.enabled && m.modelId.startsWith(`${v}/`)).length;
  const issueOf = (prefix: string) => issues.find((i) => i.id.startsWith(prefix));
  const services: Service[] = [];
  const oenSet = !!(config.oen.merchantId && config.oen.token);
  services.push({ id: "oen", name: "Oen", level: !oenSet ? "bad" : config.oen.env === "production" ? "ok" : "warn", line: { key: !oenSet ? "svcOenNotSet" : config.oen.env === "production" ? "svcOenLive" : "svcOenTest" }, href: "/admin?tab=services&id=oen" });
  for (const v of VENDORS) {
    const key = !!config.llm.providers[v.id]?.key;
    if (!key && !offered(v.id)) continue;
    const isPaused = paused.has(v.id);
    const bad = issueOf(`badKey:${v.id}`) || issueOf(`noKey:${v.id}`) || issueOf(`resume:${v.id}`) || issueOf(`dailyCap:${v.id}`);
    services.push({ id: v.id, name: v.name, level: bad ? (isPaused ? "warn" : "bad") : isPaused ? "warn" : "ok", line: { key: isPaused ? "svcPaused" : bad ? "svcKeyProblem" : "svcModels", values: { n: offered(v.id) } }, href: `/admin?tab=services&id=${v.id}` });
  }
  const otherVendors = VENDORS.filter((v) => !config.llm.providers[v.id]?.key && !offered(v.id)).length;
  if (otherVendors) services.push({ id: "moreVendors", name: "", level: "off", line: { key: "svcMoreVendors", values: { n: otherVendors } }, href: "/admin?tab=services&id=xai" });
  if (config.llm.providers.ollama?.key || offered("ollama")) services.push({ id: "ollama", name: "Ollama", level: issueOf("unserved:ollama") ? "bad" : "ok", line: { key: "svcModels", values: { n: offered("ollama") } }, href: "/admin?tab=services&id=ollama" });
  if (config.llm.providers.locutus?.key) services.push({ id: "locutus", name: "Locutus", level: hub.error ? "bad" : waiting ? "warn" : hub.linked ? "ok" : "warn", line: { key: "svcLocutus", values: { linked: hub.linked, waiting } }, href: "/admin?tab=services&id=locutus" });
  services.push({ id: "storage", name: "", level: issueOf("check:storage") ? "bad" : "ok", line: { key: config.storage.driver === "s3" ? "svcStorageS3" : "svcStorageLocal" }, href: "/admin?tab=services&id=storage" });
  services.push({ id: "boltchain", name: "Boltchain", level: config.boltchain.enabled ? "ok" : "off", line: { key: config.boltchain.enabled ? "svcOn" : "svcOff" }, href: "/admin?tab=services&id=boltchain" });
  services.push({ id: "cafeca", name: "CAFECA", level: "ok", line: { key: "svcCafeca" }, href: "/admin?tab=services&id=cafeca" });

  const restart = pendingRestart().map((p) => ({ key: p.key, label: SETTING[p.key]?.label, group: SETTING[p.key]?.group }));
  return { issues, services, restart, at: new Date() };
}
