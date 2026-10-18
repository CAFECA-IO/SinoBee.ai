export const dynamic = "force-dynamic";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { config } from "@/lib/config";
import { durations, sharePrice } from "@/lib/crowd/rules";
import { publicPrices } from "@/lib/public-config";
import { referenceBlended, currentModels, formatPrice, pricingSettings } from "@/lib/models";
import { freePlan, listPlans } from "@/lib/plans";
import { formatTokens, quotaTokens } from "@/lib/format-tokens";
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
  const [models, plans, ref, fx, free] = await Promise.all([currentModels(), listPlans({ activeOnly: true }), referenceBlended(), pricingSettings(), freePlan({ activeOnly: true })]);
  const tok = (twd: number) => (ref ? formatTokens(quotaTokens(twd, ref.blendedTwd), locale) : "—");
  return (
    <div className="container-x max-w-5xl space-y-12 py-12">
      <header>
        <h1 className="h1">{t("title")}</h1>
        <p className="mt-3 max-w-3xl text-lg text-muted">{t("lead")}</p>
      </header>

      <section id="plans" className="space-y-4">
        <h2 className="h2">{t("plans")}</h2>
        <div className={`grid gap-4 ${free ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          {free && (
            <div className="card flex flex-col gap-3 p-6" data-plan="free">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="h3">{locale.startsWith("zh") ? free.name : free.nameEn}</h3>
                <span className="text-2xl font-bold">NT$0</span>
              </div>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
                <li className="font-semibold text-ink">{t("freeUsage", { value: free.maxCostTwd.toLocaleString("en-US") })}</li>
                <li>{t("planL6", { tokens: tok(free.l6Twd) })}</li>
                <li>{t("planL168", { tokens: tok(free.l168Twd) })}</li>
                <li>{t("planConcurrency", { n: free.concurrency })}</li>
                <li>{t("freeNote")}</li>
              </ul>
              <Link href="/agent" className="btn-ghost mt-auto">{t("freeStart")}</Link>
            </div>
          )}
          {plans.map((pl) => (
            <div key={pl.id} className="card flex flex-col gap-3 p-6" data-plan={pl.code}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="h3">{locale.startsWith("zh") ? pl.name : pl.nameEn}</h3>
                <div>
                  <span className="text-2xl font-bold" data-fee>NT${pl.feeTwd.toLocaleString("en-US")}</span>
                  <span className="text-sm text-muted"> / {pl.days} {t("days")}</span>
                </div>
              </div>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
                <li className="font-semibold text-ink" data-usage>{t("planUsage", { mult: pl.multiplier, value: pl.maxCostTwd.toLocaleString("en-US") })}</li>
                <li>{t("planL6", { tokens: tok(pl.l6Twd) })}</li>
                <li>{t("planL168", { tokens: tok(pl.l168Twd) })}</li>
                <li>{t("planConcurrency", { n: pl.concurrency })}</li>
                <li>{t("planNoRenew")}</li>
              </ul>
              <Link href={`/subscribe?plan=${pl.code}`} className="btn-primary mt-auto">{t("planBuy")}</Link>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">{ref ? t("planNote", { model: ref.model.label }) : null}</p>
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
