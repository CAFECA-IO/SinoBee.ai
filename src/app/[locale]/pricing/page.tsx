export const dynamic = "force-dynamic";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { config } from "@/lib/config";
import { durations, sharePrice } from "@/lib/crowd/rules";
import { publicPrices } from "@/lib/public-config";
import { currentModels, formatPrice, pricingSettings } from "@/lib/models";
import { freePlan, listPlans } from "@/lib/plans";
import { inSentence, ladder, times } from "@/lib/plan-copy";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "pricing" });
  return { title: t("title") };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");
  const p = await publicPrices();
  // the same rows the admin backend edits (ModelPrice / Plan)
  const [models, plans, fx, free] = await Promise.all([currentModels(), listPlans({ activeOnly: true }), pricingSettings(), freePlan({ activeOnly: true })]);
  const zh = locale.startsWith("zh");
  return (
    <div className="container-x max-w-5xl space-y-12 py-12">
      <header>
        <h1 className="h1">{t("title")}</h1>
        <p className="mt-3 max-w-3xl text-lg text-muted">{t("lead")}</p>
      </header>

      <section id="plans" className="space-y-5">
        <div>
          <h2 className="h2">{t("plans")}</h2>
          <p className="mt-1 text-sm text-muted">{t("plansLead")}</p>
        </div>
        {(() => {
          const rows = ladder(free, plans).map(({ plan: pl, prev }) => {
            const isFree = pl.feeTwd <= 0;
            // the first paid plan brings what a subscription adds; the ones after it are for heavier work
            const firstPaid = !isFree && (!prev || prev.feeTwd <= 0);
            return {
              pl, prev, isFree, firstPaid,
              name: zh ? pl.name : pl.nameEn,
              tag: t.has(`tag.${pl.code}`) ? t(`tag.${pl.code}` as "tag.free") : t(isFree ? "tag.free" : firstPaid ? "tag.low" : "tag.high"),
              usage: prev ? times(pl.maxCostTwd, prev.maxCostTwd) : null,
              conc: prev && pl.concurrency !== prev.concurrency ? times(pl.concurrency, prev.concurrency) : null,
            };
          });
          const yes = <span className="font-black text-accent" aria-label="✓">✓</span>;
          const no = <span className="text-muted/50" aria-label="—">—</span>;
          const cells: [string, (r: (typeof rows)[number]) => React.ReactNode][] = [
            [t("cmp.usage"), (r) => (r.usage ? <b>{t("cmp.times", { plan: inSentence(r.prev!, zh), x: r.usage })}</b> : t("cmp.basic"))],
            [t("cmp.tasks"), (r) => (r.conc ? t("cmp.times", { plan: inSentence(r.prev!, zh), x: r.conc }) : t("cmp.n", { n: r.pl.concurrency }))],
            [t("cmp.cloud"), () => yes],
            [t("cmp.carry"), (r) => (r.isFree ? no : yes)],
            [t("cmp.noFee"), (r) => (r.isFree ? no : yes)],
            [t("cmp.keep"), (r) => (r.isFree ? t("cmp.days", { days: config.retention.freeDays }) : t("cmp.whileSub"))],
            [t("cmp.heavy"), (r) => (r.isFree || r.firstPaid ? no : yes)],
          ];
          return (
            <>
              <div className={`grid gap-4 pt-3 ${rows.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                {rows.map((r) => (
                  <div key={r.pl.id} className={`card relative flex flex-col gap-2.5 p-6 ${r.firstPaid ? "border-2 border-accent bg-gradient-to-b from-accent-soft/40 to-panel" : ""}`} data-plan={r.pl.code}>
                    {r.firstPaid && <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-3.5 py-1 text-xs font-bold text-accent-ink">{t("cmp.recommended")}</span>}
                    <h3 className="h3">{r.name}</h3>
                    <p className={`text-sm font-semibold ${r.firstPaid ? "text-accent" : "text-muted"}`} data-tagline>{r.tag}</p>
                    <div className="mt-1">
                      <span className="text-4xl font-extrabold tracking-tight" data-fee>NT${r.pl.feeTwd.toLocaleString("en-US")}</span>
                      {!r.isFree && <span className="text-sm text-muted"> / {r.pl.days} {t("days")}</span>}
                    </div>
                    {r.isFree ? (
                      <Link href="/agent" className="btn-ghost mt-auto">{t("freeStart")}</Link>
                    ) : (
                      <Link href={`/subscribe?plan=${r.pl.code}`} className="btn-primary mt-auto">{t("cmp.buy", { plan: r.name })}</Link>
                    )}
                  </div>
                ))}
              </div>
              <div className="card overflow-x-auto p-0">
                <table className="w-full min-w-[600px] text-sm" id="plan-compare">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-panel p-4 text-left font-medium text-muted"><span className="sr-only">{t("cmp.feature")}</span></th>
                      {rows.map((r) => (
                        <th key={r.pl.id} className={`p-4 text-center font-bold ${r.firstPaid ? "bg-accent-soft/40" : ""}`}>{r.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cells.map(([label, cell]) => (
                      <tr key={label} className="border-t border-line">
                        <th scope="row" className="sticky left-0 z-10 bg-panel p-4 text-left font-normal text-ink/80">{label}</th>
                        {rows.map((r) => (
                          <td key={r.pl.id} className={`p-4 text-center ${r.firstPaid ? "bg-accent-soft/40" : ""}`}>{cell(r)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}
        <p className="text-xs text-muted">{t("planNote")}</p>
      </section>

      <section className="space-y-4">
        <h2 className="h2">{t("modelTable")}</h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm" id="model-prices">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-3">{t("model")}</th>
                <th className="p-3 text-right">{t("pIn")}</th>
                <th className="p-3 text-right">{t("pCacheRead")}</th>
                <th className="p-3 text-right">{t("pCacheWrite")}</th>
                <th className="p-3 text-right">{t("pOut")}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.modelId} className="border-t border-line" data-model={m.modelId}>
                  <td className="p-3">
                    {m.label} <span className="text-xs text-muted">{m.vendor}</span>
                  </td>
                  <td className="p-3 text-right font-mono">{formatPrice(m.twd.input)}</td>
                  <td className="p-3 text-right font-mono">{formatPrice(m.twd.cacheRead)}</td>
                  <td className="p-3 text-right font-mono">{formatPrice(m.twd.cacheWrite)}</td>
                  <td className="p-3 text-right font-mono">{formatPrice(m.twd.output)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">{t("modelNote", { fx: fx.fx, buffer: fx.buffer })}</p>
      </section>

      <h2 className="h2">{t("tasksTitle")}</h2>
      <section className="card p-8 text-center">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted">{t("formula")}</div>
        <div className="mt-4 font-mono text-lg sm:text-2xl">
          {t("charge")} = {t("tokens")} + {t("vm")} + {t("s3")}
        </div>
        <p className="mt-4 text-sm text-muted">{t("formulaNote")}</p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card p-5">
          <div className="font-semibold">{t("tokens")}</div>
          <p className="mt-1 text-sm text-muted">{t("tokensBody")}</p>
        </div>
        <div className="card p-5">
          <div className="font-semibold">{t("vm")}</div>
          <p className="mt-1 text-sm text-muted">{t("vmBody", { price: p.vmHourly.toFixed(2), cpus: config.runner.cpus, mem: config.runner.memoryMb / 1024 })}</p>
        </div>
        <div className="card p-5">
          <div className="font-semibold">{t("s3")}</div>
          <p className="mt-1 text-sm text-muted">{t("s3Body", { gb: p.storageGbMonth.toFixed(2), put: p.writesPer1k, get: p.readsPer1k })}</p>
        </div>
      </section>


      <section className="grid gap-6 md:grid-cols-2">
        <div className="card p-6">
          <h2 className="h3">{t("crowdTitle")}</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>{t("crowd.share", { price: sharePrice() })}</li>
            <li>{t("crowd.fee", { fee: Math.round(config.crowd.proposalFee) })}</li>
            <li>{t("crowd.goal")}</li>
            <li>{t("crowd.leftover")}</li>
          </ul>
          <Link href="/crowd/new" className="btn-primary mt-5">{t("crowd.cta")}</Link>
        </div>
        <div className="card p-6">
          <h2 className="h3">{t("crowd.periods")}</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {durations().map((d) => (
                <tr key={d.days} className="border-b border-line last:border-0">
                  <td className="py-2">{t("crowd.days", { days: d.days })}</td>
                  <td className="py-2 text-right font-mono">{d.rate === 0 ? t("crowd.noFee") : `${+(d.rate * 100).toFixed(2)}%`}</td>
                </tr>
              ))}
              <tr>
                <td className="py-2">{t("crowd.self")}<div className="text-xs text-muted">{t("crowd.selfNote")}</div></td>
                <td className="py-2 text-right font-mono">{t("crowd.noFee")}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">{t("crowd.periodNote", { days: config.crowd.resultsDays })}</p>
        </div>
      </section>
    </div>
  );
}
