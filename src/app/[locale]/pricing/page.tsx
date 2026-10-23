export const dynamic = "force-dynamic";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { config } from "@/lib/config";
import { durations, sharePrice } from "@/lib/crowd/rules";
import { publicPrices } from "@/lib/public-config";
import { currentModels, formatPrice, pricingSettings } from "@/lib/models";
import { freePlan, listPlans } from "@/lib/plans";
import { inSentence, ladder, times } from "@/lib/plan-copy";
import { LEVEL_BONUS, LEVEL_MONTHS } from "@/lib/level";
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

      <section id="plans" className="space-y-4">
        <h2 className="h2">{t("plans")}</h2>
        <div className={`grid gap-4 ${free ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          {ladder(free, plans).map(({ plan: pl, prev }) => {
            const isFree = pl.feeTwd <= 0;
            const name = (p: { name: string; nameEn: string }) => (zh ? p.name : p.nameEn);
            const usage = prev ? times(pl.maxCostTwd, prev.maxCostTwd) : null;
            const conc = prev && pl.concurrency !== prev.concurrency ? times(pl.concurrency, prev.concurrency) : null;
            // the first paid plan brings what a subscription adds; the ones after it are for heavier work
            const firstPaid = !isFree && (!prev || prev.feeTwd <= 0);
            return (
              <div key={pl.id} className="card flex flex-col gap-3 p-6" data-plan={pl.code}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="h3">{name(pl)}</h3>
                  <div>
                    <span className="text-2xl font-bold" data-fee>NT${pl.feeTwd.toLocaleString("en-US")}</span>
                    {!isFree && <span className="text-sm text-muted"> / {pl.days} {t("days")}</span>}
                  </div>
                </div>
                <p className="text-sm font-semibold text-ink" data-tagline>{t.has(`tag.${pl.code}`) ? t(`tag.${pl.code}` as "tag.free") : t(isFree ? "tag.free" : firstPaid ? "tag.low" : "tag.high")}</p>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
                  {isFree ? (
                    <>
                      <li>{t("b.login")}</li>
                      <li>{t("b.oneTask", { n: pl.concurrency })}</li>
                      <li>{t("b.keepFree", { days: config.retention.freeDays })}</li>
                    </>
                  ) : (
                    <>
                      {prev && <li className="list-none -ml-5 font-medium text-ink">{t("b.everything", { plan: inSentence(prev, zh) })}</li>}
                      {usage && <li data-usage>{t("b.usage", { plan: inSentence(prev!, zh), x: usage })}</li>}
                      {firstPaid && <li>{t("b.carry")}</li>}
                      {conc && <li>{t("b.tasks", { plan: inSentence(prev!, zh), x: conc })}</li>}
                      {!prev && <li>{t("b.oneTask", { n: pl.concurrency })}</li>}
                      {firstPaid && <li>{t("b.noFee")}</li>}
                      {firstPaid && <li>{t("b.keep")}</li>}
                      {!firstPaid && <li>{t("b.heavy")}</li>}
                    </>
                  )}
                </ul>
                {isFree ? <Link href="/agent" className="btn-ghost mt-auto">{t("freeStart")}</Link> : <Link href={`/subscribe?plan=${pl.code}`} className="btn-primary mt-auto">{t("planBuy")}</Link>}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted">{t("planNote")}</p>
      </section>

      <section id="levels" className="space-y-4">
        <h2 className="h2">{t("levels")}</h2>
        <p className="max-w-3xl text-sm text-muted">{t("levelsLead")}</p>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm" id="level-table">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-3">{t("level")}</th>
                {LEVEL_MONTHS.map((m, i) => (
                  <th key={m} className="p-3 text-right">Lv{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="p-3">{t("levelMonths")}</td>
                {LEVEL_MONTHS.map((m) => (
                  <td key={m} className="p-3 text-right font-mono">{m}</td>
                ))}
              </tr>
              <tr className="border-t border-line">
                <td className="p-3">{t("levelBonus")}</td>
                {LEVEL_BONUS.map((b, i) => (
                  <td key={i} className="p-3 text-right font-mono">{b ? `+${Math.round(b * 100)}%` : "—"}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
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
