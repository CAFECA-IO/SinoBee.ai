/** Why /route leaves the locutus models out (read-only): npx tsx scripts/locutus-diag.ts */
import "dotenv/config";

async function main() {
  const store = await import("../src/lib/settings/store");
  await store.loadSettings({ refreshEveryMs: 0 });
  const { sv, svBool, resolve } = await import("../src/lib/settings/cache");
  const { config } = await import("../src/lib/config");
  const { pricesAt } = await import("../src/lib/models");
  const { downVendors } = await import("../src/lib/llm/breaker");
  const { pausedVendors } = await import("../src/lib/llm/pause");
  const { rank } = await import("../src/lib/llm/route");
  const { db } = await import("../src/lib/db");

  const p = config.llm.providers.locutus;
  console.log("locutus.enabled", svBool("locutus.enabled"), resolve("locutus.enabled").source);
  console.log("locutus.hubSecret set", !!sv("locutus.hubSecret"), resolve("locutus.hubSecret").source);
  console.log("provider base", p?.base || "(empty)", "key", p?.key ? "set" : "(empty)");
  for (const m of await pricesAt()) if (m.vendor === "locutus" || m.modelId.startsWith("locutus/"))
    console.log("price row", m.modelId, "enabled", m.enabled, "effective", m.effectiveAt.toISOString(), "twd", JSON.stringify(m.twd));
  const later = await db.modelPrice.findMany({ where: { modelId: { startsWith: "locutus/" } }, select: { modelId: true, enabled: true, effectiveAt: true } });
  console.log("all locutus rows", JSON.stringify(later));
  console.log("down", JSON.stringify([...(await downVendors()).entries()]));
  console.log("paused", JSON.stringify([...(await pausedVendors())]));
  const recent = await db.usageLedger.findMany({
    where: { modelId: { startsWith: "locutus/" } }, orderBy: { createdAt: "desc" }, take: 5,
    select: { createdAt: true, status: true, error: true },
  });
  console.log("recent locutus ledger", JSON.stringify(recent));
  try {
    const r = await rank({ role: "main", preference: "balanced", task_kind: "chat", needs: { tools: true } } as never);
    console.log("rank ->", r.ranked.map((x) => x.model).join(", "));
  } catch (e) {
    console.log("rank failed:", (e as Error).message);
  }
  try {
    const h = await fetch(`${p.base}/models`, { headers: { authorization: `Bearer ${p.key}` } });
    console.log("hub /openai/models", h.status, (await h.text()).slice(0, 400));
  } catch (e) {
    console.log("hub unreachable from here:", (e as Error).message);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
