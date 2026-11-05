import { config } from "@/lib/config";
import { pricesAt, pricingSettings } from "@/lib/models";
import { modelCatalogFromApi } from "@/lib/ai-models";
import { locutusServed } from "@/lib/llm/route";
import { pausedVendors } from "@/lib/llm/pause";
import { listPlans } from "@/lib/plans";
import { planEconomics } from "@/lib/admin/plan-economics";

/** The vendor answered the catalog sync that our key is not accepted (rejected, expired, revoked) */
const KEY_REJECTED = /\b40[13]\b|api key|expired|unauthori[sz]ed|permission denied/i;

/**
 * Offered models a request would fail on: not in the vendor's model list, the vendor has no API key, the vendor
 * rejected our key at the last catalog sync, or (Locutus) no linked node serves it now. Locutus models are checked
 * against the hub's live list, not the synced catalog: nodes come and go, so the snapshot is stale by nature.
 *
 * A paused vendor gets no calls (/route leaves it out, the relay refuses it), so its models are not failing now:
 * they are listed apart (`whenResumed`) as what to fix before resuming it.
 */
export async function modelProblems() {
  const [rows, catalog, paused] = await Promise.all([pricesAt(new Date()), modelCatalogFromApi(), pausedVendors()]);
  const vendorOf = (id: string) => id.split("/")[0];
  const enabled = rows.filter((m) => m.enabled);
  const offered = enabled.filter((m) => !paused.has(vendorOf(m.modelId)));
  const loc = offered.filter((m) => vendorOf(m.modelId) === "locutus");
  const served = loc.length && config.llm.providers.locutus?.key ? (await locutusServed()).all : null;
  const unserved = served ? loc.filter((m) => !served.has(m.modelId.toLowerCase())) : [];
  // local Ollama models: offered while Ollama is not set up or not answering (audit 1-2)
  const oll = offered.filter((m) => vendorOf(m.modelId) === "ollama");
  if (oll.length) {
    const { ollamaStatus } = await import("@/lib/ollama");
    const st = await ollamaStatus().catch(() => ({ configured: true, ok: false }));
    if (!st.configured || !("ok" in st) || !st.ok) unserved.push(...oll);
  }
  const unknownOf = (list: typeof rows) =>
    list.filter((m) => {
      const [p, ...rest] = m.modelId.split("/");
      if (p === "locutus") return false;
      const c = catalog[p];
      return c && c.models.length > 0 && !c.models.some((x) => x.id === rest.join("/"));
    });
  const noKeyOf = (list: typeof rows) =>
    list.filter((m) => {
      const p = config.llm.providers[vendorOf(m.modelId)];
      return p ? !p.key && vendorOf(m.modelId) !== "ollama" : false;
    });
  const badKeyOf = (list: typeof rows) =>
    list.filter((m) => {
      const v = vendorOf(m.modelId);
      return !!config.llm.providers[v]?.key && KEY_REJECTED.test(catalog[v]?.error ?? "");
    });
  const vendorsOf = (list: typeof rows) => [...new Set(list.map((m) => vendorOf(m.modelId)))];
  const resting = enabled.filter((m) => paused.has(vendorOf(m.modelId)));
  const whenResumed = [
    ...vendorsOf(noKeyOf(resting)).map((vendor) => ({ vendor, why: "noKey" as const })),
    ...vendorsOf(badKeyOf(resting)).map((vendor) => ({ vendor, why: "badKey" as const, error: catalog[vendor]?.error ?? "" })),
  ];
  return { unknown: unknownOf(offered), noKey: noKeyOf(offered), badKey: badKeyOf(offered), unserved, whenResumed };
}

/** Sidebar warnings: plans that lose money, offered models that would fail */
export async function navWarnings() {
  const [{ buffer }, plans, problems] = await Promise.all([pricingSettings(), listPlans({ activeOnly: true }), modelProblems()]);
  const econ = await Promise.all(plans.map((p) => planEconomics(p, buffer)));
  return {
    plans: econ.filter((e) => e.margin !== null && e.margin < 1).length,
    models: problems.unknown.length + problems.unserved.length + (problems.noKey.length ? 1 : 0) + (problems.badKey.length ? 1 : 0),
  };
}
