import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { listPlans } from "@/lib/plans";
import { cheapestBlended } from "@/lib/models";
import { subscriptionState } from "@/lib/subscriptions";
import { formatTokens, quotaTokens } from "@/lib/format-tokens";
import { SubscribeForm } from "@/components/subscribe-form";
import { LocalDate } from "@/components/date";
import type { Buyer } from "@/components/checkout";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "subscribe" });
  return { title: t("title") };
}

export default async function SubscribePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ plan?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const plan = (await searchParams).plan;
  const me = await currentUser();
  if (!me) redirect({ href: `/login?next=${encodeURIComponent(`/subscribe${plan ? `?plan=${plan}` : ""}`)}`, locale });
  const t = await getTranslations("subscribe");
  const [plans, cheap, st] = await Promise.all([listPlans({ activeOnly: true }), cheapestBlended(), subscriptionState(me!.id)]);
  const tok = (twd: number) => (cheap ? formatTokens(quotaTokens(twd, cheap.blendedTwd), locale) : "—");
  const zh = locale.startsWith("zh");
  const stacks = st.endsAt && st.endsAt > new Date();
  return (
    <div className="container-x max-w-3xl space-y-6 py-12">
      <header>
        <h1 className="h1">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("lead")}</p>
      </header>
      {st.current && (
        <p className="rounded-xl bg-accent-soft p-4 text-sm" data-state="active">
          {t("current", { plan: plans.find((p) => p.id === st.current!.planId)?.[zh ? "name" : "nameEn"] ?? st.current.plan })} <LocalDate value={st.endsAt!} withTime={false} />
        </p>
      )}
      {st.inGrace && (
        <p className="rounded-xl bg-warn-soft p-4 text-sm text-warn">
          {t("grace")} <LocalDate value={st.graceEndsAt!} withTime={false} />
        </p>
      )}
      <section className="card p-6">
        <SubscribeForm
          plans={plans.map((p) => ({ id: p.id, code: p.code, name: zh ? p.name : p.nameEn, fee: p.feeTwd, mult: p.multiplier, l6: tok(p.l6Twd), l168: tok(p.l168Twd), concurrency: p.concurrency }))}
          initial={plan}
          buyer={(me!.billing ?? null) as Buyer | null}
          startsLabel={stacks ? t("stacks", { date: st.endsAt!.toISOString().slice(0, 10) }) : t("startsNow")}
        />
      </section>
    </div>
  );
}
