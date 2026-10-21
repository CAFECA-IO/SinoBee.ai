import { config } from "@/lib/config";
import { pricesAt, pricingSettings } from "@/lib/models";
import { modelCatalogFromApi } from "@/lib/ai-models";
import { listPlans } from "@/lib/plans";
import { planEconomics } from "@/lib/admin/plan-economics";

/** Offered models a request would fail on: not in the vendor's model list, or the vendor has no API key */
export async function modelProblems() {
  const [rows, catalog] = await Promise.all([pricesAt(new Date()), modelCatalogFromApi()]);
  const offered = rows.filter((m) => m.enabled);
  const vendorOf = (id: string) => id.split("/")[0];
  const unknown = offered.filter((m) => {
    const [p, ...rest] = m.modelId.split("/");
    const c = catalog[p];
    return c && c.models.length > 0 && !c.models.some((x) => x.id === rest.join("/"));
  });
  const noKey = offered.filter((m) => {
    const p = config.llm.providers[vendorOf(m.modelId)];
    return p ? !p.key && vendorOf(m.modelId) !== "ollama" : false;
  });
  return { unknown, noKey };
}

/** Sidebar warnings: plans that lose money, offered models that would fail */
export async function navWarnings() {
  const [{ buffer }, plans, problems] = await Promise.all([pricingSettings(), listPlans({ activeOnly: true }), modelProblems()]);
  const econ = await Promise.all(plans.map((p) => planEconomics(p, buffer)));
  return {
    plans: econ.filter((e) => e.margin !== null && e.margin < 1).length,
    models: problems.unknown.length + (problems.noKey.length ? 1 : 0),
  };
}
