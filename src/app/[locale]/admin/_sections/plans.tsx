import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { listPlans } from "@/lib/plans";
import { pricingSettings, referenceBlended } from "@/lib/models";
import { HEALTHY_MARGIN } from "@/lib/price-math";
import { marginLevel, planEconomics, suggestions } from "@/lib/admin/plan-economics";
import { marginText } from "@/lib/admin/margin";
import { ApplyPlanChange, FreePlanForm, PlanForm, type PlanData } from "@/components/admin/plan-actions";
import { Banner, DetailPanel, PageHead, PanelSection, Split, Tag, adminHref, twd } from "@/components/admin/kit";
import type { AdminParams } from "../page";

const n2 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const big = (n: number, zh: boolean) => (zh ? (n >= 1e8 ? `${n2(Math.round(n / 1e6) / 100)} 億` : n >= 1e4 ? `${n2(Math.round(n / 1e3) / 10)} 萬` : n2(n)) : n >= 1e6 ? `${n2(Math.round(n / 1e5) / 10)}M` : n >= 1e3 ? `${n2(Math.round(n / 100) / 10)}K` : n2(n));
/** where a margin sits on the bar: 0 → 0%, 1 (break-even) → 50%, 1.5 (healthy) → 75%, ≥ 2 → 100% */
const pos = (m: number) => (Number.isFinite(m) ? Math.max(1, Math.min(99, m * 50)) : 99);

export async function Plans({ sp }: { sp: AdminParams }) {
  const t = await getTranslations("admin.pl");
  const tp = await getTranslations("admin.plans");
  const ta = await getTranslations("admin");
  const zh = (await getLocale()).startsWith("zh");
  const [plans, s, ref] = await Promise.all([listPlans({ includeFree: true }), pricingSettings(), referenceBlended()]);
  const tokensPerTwd = ref && ref.blendedTwd > 0 ? 1e6 / ref.blendedTwd : 0;
  const now = new Date();
  const econ = new Map(await Promise.all(plans.map(async (p) => [p.id, await planEconomics(p, s.buffer, now)] as const)));
  const subs = await db.subscription.groupBy({ by: ["planId"], where: { cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, _count: { _all: true } });
  const subCount = (id: string) => subs.find((x) => x.planId === id)?._count._all ?? 0;
  const paid = plans.filter((p) => p.feeTwd > 0);
  const free = plans.find((p) => p.feeTwd <= 0);
  const pro = paid.find((p) => p.code === "low") ?? [...paid].sort((a, b) => a.feeTwd - b.feeTwd)[0];
  const losing = paid.filter((p) => p.active && (econ.get(p.id)?.margin ?? 2) < 1);
  const base = { tab: "plans" };
  const data = (p: (typeof plans)[number]): PlanData => ({ id: p.id, code: p.code, name: p.name, nameEn: p.nameEn, feeTwd: p.feeTwd, multiplier: p.multiplier, concurrency: p.concurrency, active: p.active, sortOrder: p.sortOrder });

  let panel: React.ReactNode = null;
  if (sp.plan === "new") {
    panel = <DetailPanel title={tp("addPlan")} closeHref={adminHref(base, {})} closeLabel={t("close")}><PanelSection><PlanForm buffer={s.buffer} tokensPerTwd={tokensPerTwd} closeHref="/admin?tab=plans" /></PanelSection></DetailPanel>;
  } else if (sp.plan) {
    const p = plans.find((x) => x.code === sp.plan);
    if (p && p.feeTwd <= 0)
      panel = (
        <DetailPanel title={p.name} sub={tp("freeHelp")} closeHref={adminHref(base, {})} closeLabel={t("close")}>
          <PanelSection><FreePlanForm plan={{ name: p.name, nameEn: p.nameEn, maxCostTwd: p.maxCostTwd, concurrency: p.concurrency, active: p.active }} proMax={pro?.maxCostTwd ?? 0} proName={pro?.name ?? "Pro"} tokensPerTwd={tokensPerTwd} closeHref="/admin?tab=plans" /></PanelSection>
        </DetailPanel>
      );
    else if (p)
      panel = (
        <DetailPanel title={p.name} sub={<span className="font-mono">{p.code}</span>} closeHref={adminHref(base, {})} closeLabel={t("close")}>
          <PanelSection><PlanForm key={p.id} plan={data(p)} buffer={s.buffer} tokensPerTwd={tokensPerTwd} closeHref="/admin?tab=plans" /></PanelSection>
        </DetailPanel>
      );
  }

  const cards = (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label={t("compare")}>
        {plans.map((p) => {
          const e = econ.get(p.id)!;
          const isFree = p.feeTwd <= 0;
          const m = e.margin;
          const lvl = m === null ? null : marginLevel(m);
          return (
            <article key={p.id} className={`card flex flex-col gap-3 p-4 ${sp.plan === p.code ? "!border-accent" : ""}`} data-plan={p.code}>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{zh ? p.name : p.nameEn}</h2>
                <Tag tone={p.active ? "ok" : "muted"}>{p.active ? t("onSale") : t("offSale")}</Tag>
                <span className="flex-1" />
                <Link className="text-sm text-accent" href={adminHref(base, { plan: p.code })}>{t("edit")}</Link>
              </div>
              <div><span className="text-2xl font-bold tabular-nums">{isFree ? "NT$0" : twd(p.feeTwd)}</span> <span className="text-sm text-muted">{isFree ? t("freeWho") : t("perMonth")}</span></div>
              {m !== null ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">{e.basis === "actual" ? t("basisActual", { n: e.sample }) : t("basisFull")}</span>
                    <span className={`font-semibold ${lvl === "loss" ? "text-err" : lvl === "thin" ? "text-warn" : "text-ok"}`} data-calc="margin">{marginText(m, t)}</span>
                  </div>
                  <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, var(--err-soft) 0 50%, var(--warn-soft) 50% 75%, var(--accent-soft) 75% 100%)" }} role="img" aria-label={marginText(m, t)}>
                    <span className="absolute -top-1 h-4 w-1 rounded bg-ink" style={{ left: `calc(${pos(m)}% - 2px)` }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted"><span>{t("barLoss")}</span><span>{t("barEven")}</span><span>{t("barHealthy")}</span></div>
                  {e.basis === "actual" && e.fullMargin !== null && <div className="text-[11px] text-muted">{t("worstCase", { m: marginText(e.fullMargin, t) })}</div>}
                </div>
              ) : (
                <div className="text-xs text-muted">{e.basis === "actual" ? t("freeCost", { cost: twd(e.costTwd, 2), n: e.sample }) : t("freeCostFull", { cost: twd(e.costTwd, 2) })}</div>
              )}
              <dl className="divide-y divide-line text-sm">
                {[
                  [t("allowance"), twd(p.maxCostTwd, p.maxCostTwd < 100 ? 2 : 0)],
                  [t("about"), tokensPerTwd ? t("tokens", { n: big(p.maxCostTwd * tokensPerTwd, zh) }) : "—"],
                  [t("cap6"), twd(p.l6Twd, 2)],
                  [t("cap7"), twd(p.l168Twd, 2)],
                  [ta("plans.concurrency"), String(p.concurrency)],
                  ...(isFree ? [] : [[t("subscribers"), t("people", { n: subCount(p.id) })]]),
                  ...(e.basis === "actual" && !isFree ? [[t("avgUse"), `${twd(e.avgUseTwd, 0)} (${Math.round(e.utilization * 100)}%)`]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-muted">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>
                ))}
              </dl>
            </article>
          );
        })}
      </section>

      {paid.map((p) => {
        const e = econ.get(p.id)!;
        const sug = suggestions(p, e, s.buffer);
        if (!sug.length) return null;
        return (
          <section key={p.id} className="card space-y-3 p-4" aria-labelledby={`fix-${p.code}`}>
            <h2 id={`fix-${p.code}`} className="h3">{e.margin !== null && e.margin < 1 ? t("fixLoss", { plan: p.name }) : t("fixThin", { plan: p.name })}</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {sug.map((x, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                  {x.kind === "multiplier" ? (
                    <>
                      <div className="text-sm font-semibold">{t("sugMult", { from: n2(p.multiplier), to: n2(x.value) })}</div>
                      <div className="flex-1 text-xs text-muted">{t(x.margin >= HEALTHY_MARGIN ? "sugMultHealthy" : "sugMultEven", { from: twd(p.maxCostTwd), to: twd(x.maxCostTwd) })}</div>
                      <ApplyPlanChange plan={data(p)} change={{ multiplier: x.value }} primary={x.margin >= HEALTHY_MARGIN} label={t("applyTo", { plan: p.name })} confirm={t("applyConfirm", { plan: p.name, n: subCount(p.id) })} />
                    </>
                  ) : x.kind === "fee" ? (
                    <>
                      <div className="text-sm font-semibold">{t("sugFee", { from: twd(p.feeTwd), to: twd(x.value) })}</div>
                      <div className="flex-1 text-xs text-muted">{t("sugFeeHelp")}</div>
                      <ApplyPlanChange plan={data(p)} change={{ feeTwd: x.value, multiplier: Math.round(((p.feeTwd * p.multiplier) / x.value) * 100) / 100 }} primary label={t("applyTo", { plan: p.name })} confirm={t("applyFeeConfirm", { plan: p.name })} />
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-semibold">{t("sugBuffer", { from: n2(s.buffer), to: n2(x.value) })}</div>
                      <div className="flex-1 text-xs text-muted">{t("sugBufferHelp", { pct: Math.round((x.value / s.buffer - 1) * 100) })}</div>
                      <Link className="btn-ghost !py-1.5 self-start" href="/admin?tab=models">{t("toModels")}</Link>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <p className="text-xs text-muted">{t("how", { model: ref?.model.label ?? "—" })}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHead title={ta("tab.plans")} sub={<>{t("headSub", { buffer: s.buffer })} <Link className="text-accent" href="/admin?tab=models">{t("bufferWhere")}</Link></>}>
        <Link className="btn-primary !py-1.5" href={adminHref(base, { plan: "new" })}>{tp("addPlan")}</Link>
      </PageHead>
      {losing.length > 0 && <Banner tone="err" title={t("losing", { n: losing.length })}>{losing.map((p) => `${p.name} ${marginText(econ.get(p.id)!.margin!, t)}`).join("、")}</Banner>}
      <Split list={cards} detail={panel} />
    </div>
  );
}
