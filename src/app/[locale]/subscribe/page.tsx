import { inSentence, ladder, times } from "@/lib/plan-copy";
import { checkoutCards } from "@/lib/crowd/cards";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { freePlan, listPlans } from "@/lib/plans";
import { subscriptionState, upgradeCreditMs } from "@/lib/subscriptions";
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
  const [plans, free, st] = await Promise.all([listPlans({ activeOnly: true }), freePlan({ activeOnly: true }), subscriptionState(me!.id)]);
  const zh = locale.startsWith("zh");
  const tp = await getTranslations("pricing");
  // each plan as the pricing page describes it: its line, and how it compares with the plan before it
  const copy = Object.fromEntries(
    ladder(free, plans).map(({ plan: p, prev }) => {
      const firstPaid = !prev || prev.feeTwd <= 0;
      const usage = prev ? times(p.maxCostTwd, prev.maxCostTwd) : null;
      const conc = prev && p.concurrency !== prev.concurrency ? times(p.concurrency, prev.concurrency) : null;
      const tag = tp.has(`tag.${p.code}`) ? tp(`tag.${p.code}` as "tag.free") : tp(firstPaid ? "tag.low" : "tag.high");
      const lines = [usage && tp("b.usage", { plan: inSentence(prev!, zh), x: usage }), conc && tp("b.tasks", { plan: inSentence(prev!, zh), x: conc })].filter(Boolean).join(" · ");
      return [p.id, { tag, lines }];
    }),
  );
  const now = new Date();
  const stacks = st.endsAt && st.endsAt > now;
  const curPlan = st.current ? plans.find((p) => p.id === st.current!.planId) ?? plans.find((p) => p.code === st.current!.plan) : undefined;
  // what happens when each plan is bought now: upgrade right away (more expensive than the running plan), or stack after
  const startsLabels = Object.fromEntries(
    plans.map((p) => {
      if (st.current && curPlan && p.feeTwd > curPlan.feeTwd) {
        const credit = upgradeCreditMs(st.current.endsAt.getTime() - now.getTime(), curPlan, p) / 86400_000;
        return [p.id, t("upgradeNow", { from: zh ? curPlan.name : curPlan.nameEn, days: p.days + Math.floor(credit), credit: credit.toFixed(1) })];
      }
      return [p.id, stacks ? t("stacks", { date: st.endsAt!.toISOString().slice(0, 10) }) : t("startsNow")];
    }),
  );
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
          plans={plans.map((p) => ({ id: p.id, code: p.code, name: zh ? p.name : p.nameEn, fee: p.feeTwd, tag: copy[p.id]?.tag ?? "", lines: copy[p.id]?.lines ?? "" }))}
          initial={plan}
          buyer={(me!.billing ?? null) as Buyer | null}
          {...await checkoutCards(me!.id)}
          startsLabels={startsLabels}
        />
      </section>
    </div>
  );
}
