export const dynamic = "force-dynamic";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { config } from "@/lib/config";
import { MODELS } from "@/lib/pricing";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "pricing" });
  return { title: t("title") };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("pricing");
  const p = config.pricing;
  return (
    <div className="container-x max-w-5xl space-y-12 py-12">
      <header>
        <h1 className="h1">{t("title")}</h1>
        <p className="mt-3 max-w-3xl text-lg text-muted">{t("lead")}</p>
      </header>

      <section className="card p-8 text-center">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted">{t("formula")}</div>
        <div className="mt-4 font-mono text-lg sm:text-2xl">
          {t("charge")} = <span className="text-accent">{p.markup}</span> × ( {t("tokens")} + {t("vm")} + {t("s3")} )
        </div>
        <p className="mt-4 text-sm text-muted">{t("formulaNote", { rate: p.usdTwd })}</p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card p-5">
          <div className="font-semibold">{t("tokens")}</div>
          <p className="mt-1 text-sm text-muted">{t("tokensBody")}</p>
        </div>
        <div className="card p-5">
          <div className="font-semibold">{t("vm")}</div>
          <p className="mt-1 text-sm text-muted">{t("vmBody", { price: p.vmHourlyUsd, cpus: config.runner.cpus, mem: config.runner.memoryMb / 1024 })}</p>
        </div>
        <div className="card p-5">
          <div className="font-semibold">{t("s3")}</div>
          <p className="mt-1 text-sm text-muted">{t("s3Body", { gb: p.s3GbMonthUsd, put: p.s3PutPer1kUsd, get: p.s3GetPer1kUsd })}</p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="h2">{t("modelTable")}</h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-3">{t("model")}</th>
                <th className="p-3">{t("listIn")}</th>
                <th className="p-3">{t("listOut")}</th>
                <th className="p-3">{t("ourIn")}</th>
                <th className="p-3">{t("ourOut")}</th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="p-3">
                    {m.label} <span className="text-xs text-muted">{m.vendor}</span>
                  </td>
                  <td className="p-3 font-mono">${m.input}</td>
                  <td className="p-3 font-mono">${m.output}</td>
                  <td className="p-3 font-mono">{(m.input * p.markup * p.usdTwd).toFixed(2)}</td>
                  <td className="p-3 font-mono">{(m.output * p.markup * p.usdTwd).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">{t("modelNote")}</p>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="card p-6">
          <h2 className="h3">{t("free")}</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>{t("freeA", { days: config.retention.freeDays })}</li>
            <li>{t("freeB", { days: config.retention.freeDays })}</li>
            <li>{t("freeC")}</li>
          </ul>
        </div>
        <div className="card border-accent p-6">
          <h2 className="h3">
            {t("sub")} <span className="text-accent">{config.subscription.priceTwdc} TWDC</span>
            <span className="text-sm text-muted"> / {config.subscription.days} {t("days")}</span>
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>{t("subA")}</li>
            <li>{t("subB", { days: config.retention.subscriberDays })}</li>
            <li>{t("subC")}</li>
          </ul>
          <Link href="/account#subscription" className="btn-primary mt-5">{t("subscribe")}</Link>
        </div>
      </section>

      <section className="card space-y-2 p-6 text-sm text-muted">
        <h2 className="h3 text-ink">{t("budgetTitle")}</h2>
        {[0, 1, 2, 3].map((i) => (
          <p key={i}>{t(`budget.${i}`)}</p>
        ))}
      </section>
    </div>
  );
}
