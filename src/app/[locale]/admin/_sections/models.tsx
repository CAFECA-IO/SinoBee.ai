import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { config } from "@/lib/config";
import { formatPrice, priceHistory, pricesAt, pricingSettings, scheduledPrices, type ModelPriceView } from "@/lib/models";
import { TIERS, modelCatalogFromApi, tierConfig } from "@/lib/ai-models";
import { pauses } from "@/lib/llm/pause";
import { LocalDate } from "@/components/date";
import { CatalogSync, PriceLookup, TierEditor } from "@/components/admin-ai";
import { OllamaAdmin } from "@/components/admin-ollama";
import { ModelPriceForm, PricingFormula, VendorPauseSwitch } from "@/components/admin/model-actions";
import { Banner, DetailPanel, PageHead, PanelSection, Split, Tag, adminHref } from "@/components/admin/kit";
import { modelProblems } from "./warnings";
import type { AdminParams } from "../page";

const FAR = new Date(8.64e15);

export async function Models({ sp }: { sp: AdminParams }) {
  const t = await getTranslations("admin.md");
  const tai = await getTranslations("admin.ai");
  const tp = await getTranslations("admin.prices");
  const ta = await getTranslations("admin");
  const now = new Date();
  const [current, future, scheduled, s, catalog, tiers, paused, problems] = await Promise.all([
    pricesAt(now), pricesAt(FAR), scheduledPrices(now), pricingSettings(), modelCatalogFromApi(), tierConfig(), pauses(true), modelProblems(),
  ]);
  const byId = new Map(current.map((m) => [m.modelId, m]));
  const rows: (ModelPriceView & { upcoming: boolean })[] = future.map((m) => (byId.has(m.modelId) ? { ...byId.get(m.modelId)!, upcoming: false } : { ...m, upcoming: true }));
  const providers = Object.keys(config.llm.providers);
  const hasKey = (p: string) => p === "ollama" || !!config.llm.providers[p]?.key;
  const vendorOf = (id: string) => id.split("/")[0];
  const vendors = [...new Set([...rows.map((m) => vendorOf(m.modelId)), ...providers])];
  const unknown = new Set(problems.unknown.map((m) => m.modelId));
  const sched = new Map<string, ModelPriceView[]>();
  for (const r of scheduled) sched.set(r.modelId, [...(sched.get(r.modelId) ?? []), r]);
  const priced = Object.fromEntries(future.map((m) => [m.modelId, m.enabled]));
  const base = { tab: "models" };

  // why a model in a tier chain would be skipped
  const issue = (id: string) => {
    const m = byId.get(id);
    if (!hasKey(vendorOf(id))) return t("issue.noKey");
    if (paused[vendorOf(id)]?.since) return t("issue.paused");
    if (!m) return t("issue.unpriced");
    if (!m.enabled) return t("issue.withdrawn");
    if (unknown.has(id)) return t("issue.unknown");
    return null;
  };
  const label = (id: string) => byId.get(id)?.label ?? id.split("/").slice(1).join("/");

  let panel: React.ReactNode = null;
  if (sp.model === "new") {
    panel = (
      <DetailPanel title={t("addModel")} closeHref={adminHref(base, {})} closeLabel={t("close")}>
        <PanelSection><ModelPriceForm fx={s.fx} buffer={s.buffer} closeHref="/admin?tab=models" /></PanelSection>
      </DetailPanel>
    );
  } else if (sp.model) {
    const m = rows.find((r) => r.modelId === sp.model);
    const hist = await priceHistory(sp.model);
    if (m) {
      panel = (
        <DetailPanel title={m.label} sub={<span className="font-mono">{m.modelId}</span>} closeHref={adminHref(base, {})} closeLabel={t("close")}>
          <PanelSection>
            <ModelPriceForm key={m.rowId} fx={s.fx} buffer={s.buffer} row={{ modelId: m.modelId, label: m.label, vendor: m.vendor, usd: m.usd, enabled: m.enabled, sortOrder: m.sortOrder }} />
          </PanelSection>
          <PanelSection title={t("history")}>
            <ul className="space-y-1 text-xs">
              {hist.slice(0, 12).map((h) => (
                <li key={h.rowId} className="flex flex-wrap gap-x-2">
                  <span className="w-36 text-muted"><LocalDate value={h.effectiveAt} /></span>
                  <span className="font-mono">${h.usd.input} / ${h.usd.output}</span>
                  {!h.enabled && <Tag tone="muted">{tp("withdrawn")}</Tag>}
                  {h.effectiveAt > now ? <Tag tone="info">{t("scheduled")}</Tag> : h.rowId === byId.get(m.modelId)?.rowId ? <Tag tone="ok">{t("currentPrice")}</Tag> : null}
                </li>
              ))}
            </ul>
          </PanelSection>
        </DetailPanel>
      );
    }
  }

  const groups = (
    <div className="space-y-3">
      {vendors.map((v) => {
        const models = rows.filter((m) => vendorOf(m.modelId) === v);
        const c = catalog[v];
        const p = paused[v];
        const vlabel = models[0]?.vendor || (v === "ollama" ? "Ollama" : v);
        return (
          <section key={v} className="card overflow-hidden" data-vendor={v}>
            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 ${p?.since ? "bg-warn-soft/40" : "bg-panel-2/60"}`}>
              <span className="font-semibold">{vlabel}</span>
              {v === "ollama" ? <Tag tone="muted">{t("local")}</Tag> : hasKey(v) ? <Tag tone="ok">{t("keyOk")}</Tag> : <Link href="/admin?tab=settings&group=apiKeys"><Tag tone="err">{tai("noKey")}</Tag></Link>}
              <span className="text-xs text-muted">{c ? tai("modelCount", { n: c.models.length }) + " · " : ""}{t("offeredN", { n: models.filter((m) => m.enabled).length, all: models.length })}</span>
              {c?.error && <span className="text-xs text-err">{c.error}</span>}
              <span className="flex-1" />
              {models.length > 0 && <VendorPauseSwitch vendor={v} label={vlabel} paused={!!p?.since} offered={models.filter((m) => m.enabled).length} />}
            </div>
            {models.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">{v === "ollama" ? t("ollamaNone") : t("noModels")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 font-medium">{t("model")}</th>
                      {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => <th key={k} className="px-3 py-2 text-right font-medium">{tp(`k.${k}`)}</th>)}
                      <th className="px-4 py-2 font-medium">{t("state")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m) => {
                      const on = sp.model === m.modelId;
                      return (
                        <tr key={m.modelId} className={`border-b border-line last:border-0 ${on ? "bg-accent-soft" : "hover:bg-panel-2"}`} data-model={m.modelId}>
                          <td className="px-4 py-2">
                            <Link href={adminHref(base, { model: m.modelId })} className="font-semibold">{m.label}</Link>
                            <div className="font-mono text-[11px] text-muted">{m.modelId}</div>
                          </td>
                          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
                            <td key={k} className="px-3 py-2 text-right font-mono text-[13px]" title={`USD ${m.usd[k]}`}>{formatPrice(m.twd[k])}</td>
                          ))}
                          <td className="space-x-1 px-4 py-2">
                            {m.upcoming ? <Tag tone="info">{t("upcoming")}</Tag> : m.enabled ? <Tag tone="ok">{t("offered")}</Tag> : <Tag tone="muted">{tp("withdrawn")}</Tag>}
                            {unknown.has(m.modelId) && <Tag tone="err">{t("issue.unknown")}</Tag>}
                            {sched.has(m.modelId) && !m.upcoming && <Tag tone="info">{t("changeScheduled")}</Tag>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      <p className="text-xs text-muted">{t("unitNote")}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHead title={ta("tab.models")} sub={t("formula", { fx: s.fx, buffer: s.buffer })}>
        <CatalogSync disabled={!providers.some(hasKey)} />
        <Link className="btn-primary !py-1.5" href={adminHref(base, { model: "new" })}>{t("addModel")}</Link>
      </PageHead>
      {problems.unknown.length > 0 && <Banner tone="err" title={t("unknownTitle", { n: problems.unknown.length })}>{tp("unknownIds", { models: problems.unknown.map((m) => m.modelId).join(", ") })}</Banner>}
      {problems.noKey.length > 0 && (
        <Banner tone="warn" title={t("noKeyTitle", { n: problems.noKey.length })} action={<Link className="btn-ghost !py-1.5" href="/admin?tab=settings&group=apiKeys">{t("addKeys")}</Link>}>
          {problems.noKey.map((m) => m.label).join("、")}
        </Banner>
      )}

      <section className="card space-y-3 p-4" aria-labelledby="tiers">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="tiers" className="h3">{t("tiersTitle")}</h2>
          <span className="text-xs text-muted">{t("tiersHelp")}</span>
        </div>
        <ul className="space-y-2">
          {TIERS.map((k) => {
            const chain = tiers.tiers[k];
            return (
              <li key={k} className="flex flex-wrap items-center gap-2">
                <span className="w-14 shrink-0 text-sm font-semibold">{tai(`tier.${k}`)}</span>
                {chain.length === 0 ? (
                  <span className="text-sm text-muted">{t("auto")}</span>
                ) : (
                  chain.map((id, i) => {
                    const why = issue(id);
                    return (
                      <span key={id} className="inline-flex items-center gap-2">
                        <Link href={adminHref(base, { model: id })} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] ${why ? "border-err/40" : "border-line"} hover:border-accent`}>
                          <span className={`h-2 w-2 rounded-full ${why ? "bg-err" : "bg-ok"}`} aria-hidden />
                          {label(id)}
                          {why && <span className="text-xs text-err">{why}</span>}
                        </Link>
                        {i < chain.length - 1 && <span className="text-muted" aria-hidden>→</span>}
                      </span>
                    );
                  })
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted">{t("jobsLine", { list: (["spec", "screening", "checklist", "pricing"] as const).map((j) => `${tai(`job.${j}`)} → ${tai(`tier.${tiers.jobs[j]}`)}`).join(" · ") })}</p>
        <details className="rounded-xl border border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-accent">{t("editTiers")}</summary>
          <div className="border-t border-line p-3">
            <TierEditor tiers={tiers.tiers} jobs={tiers.jobs} catalog={catalog} priced={priced} />
          </div>
        </details>
      </section>

      <Split list={groups} detail={panel} />

      {scheduled.length > 0 && (
        <section className="card p-4 text-sm">
          <h2 className="h3 mb-2">{tp("scheduled")}</h2>
          <ul className="divide-y divide-line">
            {scheduled.map((m) => (
              <li key={m.rowId} className="flex flex-wrap gap-x-4 gap-y-1 py-2">
                <Link href={adminHref(base, { model: m.modelId })} className="font-mono text-xs text-accent">{m.modelId}</Link>
                <span className="font-mono text-xs">${m.usd.input} / ${m.usd.output}{m.enabled ? "" : ` · ${tp("withdrawn")}`}</span>
                <span className="text-xs text-muted"><LocalDate value={m.effectiveAt} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="card">
        <summary className="cursor-pointer px-4 py-3 font-semibold">{t("formulaEdit")}</summary>
        <div className="border-t border-line p-4"><PricingFormula fx={s.fx} buffer={s.buffer} /></div>
      </details>
      <details className="card">
        <summary className="cursor-pointer px-4 py-3 font-semibold">{tai("addTitle")}</summary>
        <div className="border-t border-line p-4"><PriceLookup catalog={catalog} priced={priced} /></div>
      </details>
      <OllamaAdmin />
    </div>
  );
}
