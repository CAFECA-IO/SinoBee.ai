import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { config } from "@/lib/config";
import { LocalDate } from "@/components/date";
import { Icon } from "@/components/icon";
import { LATE_MS, adminInbox, adminStats, adminStatsDetail, recentAudit, settingsHealth, type InboxKind } from "@/lib/admin-overview";
import { listPlans } from "@/lib/plans";
import { Banner, Empty, FilterLink, Kpi, PageHead, Tag, type Tone, twd, waited } from "@/components/admin/kit";
import { auditSummary } from "./audit-text";
import type { AdminParams } from "../page";

const KIND_TONE: Record<InboxKind, Tone> = { skill: "accent", tool: "accent", report: "err", screening: "info", dispute: "info", payment: "warn" };
const FILTERS = ["all", "review", "report", "crowd", "payment"] as const;
const inFilter = (f: string, k: InboxKind) =>
  f === "all" || (f === "review" && (k === "skill" || k === "tool")) || (f === "report" && k === "report") || (f === "crowd" && (k === "screening" || k === "dispute")) || (f === "payment" && k === "payment");

export async function Overview({ superAdmin, sp }: { superAdmin: boolean; sp: AdminParams }) {
  const t = await getTranslations("admin.ov");
  const tw = await getTranslations("admin.wait");
  const ta = await getTranslations("admin");
  const now = new Date();
  const [stats, more, inbox, checks, recent, plans] = await Promise.all([adminStats(), adminStatsDetail(now), adminInbox(now), Promise.resolve(settingsHealth()), recentAudit(5), listPlans({ includeFree: true })]);
  const blocking = checks.filter((c) => !c.ok && c.level === "error");
  const advice = checks.filter((c) => !c.ok && c.level === "warn");
  const f = (FILTERS as readonly string[]).includes(sp.f ?? "") ? sp.f! : "all";
  const rows = inbox.filter((i) => inFilter(f, i.kind));
  const count = (x: string) => inbox.filter((i) => inFilter(x, i.kind)).length;
  const planName = new Map(plans.map((p) => [p.code, p.name]));
  const subsLine = Object.entries(more.subsByPlan).map(([code, n]) => `${planName.get(code) ?? code} ${n}`).join(" · ");
  const summaries = await Promise.all(recent.map((a) => auditSummary(a)));
  const errRate = stats.relayCalls24h ? Math.round((more.relayErrors24h / stats.relayCalls24h) * 1000) / 10 : null;

  return (
    <div className="space-y-5">
      <PageHead title={ta("tab.overview")}>
        <Link href="/admin?tab=settings&group=payments" className={`chip !py-1 text-[13px] ${config.testMode ? "!border-warn bg-warn-soft !text-warn" : ""}`}>
          <span className={`h-2 w-2 rounded-full ${config.testMode ? "bg-warn" : "bg-ok"}`} aria-hidden />
          {config.testMode ? t("modeTest") : t("modeLive")}
          <span className="text-muted">· Oen {config.payments.mode === "mock" ? "mock" : config.oen.env}</span>
        </Link>
      </PageHead>

      {blocking.length > 0 && (
        <section className="card space-y-3 border-err/40 bg-err-soft/30 p-4" aria-labelledby="blocking">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="blocking" className="font-semibold text-err">{t("blocking", { n: blocking.length })}</h2>
            {advice.length > 0 && <span className="text-sm text-muted">{t("adviceCount", { n: advice.length })}</span>}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {blocking.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-err/30 bg-panel px-3 py-2.5" data-check={c.id}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{t(`check.${c.id}.title`)}{c.detail && <span className="ml-2 font-mono text-xs text-muted">{c.detail}</span>}</div>
                  <div className="text-xs text-muted">{t(`check.${c.id}.fix`)}</div>
                </div>
                <Link className="btn-primary !px-3 !py-1.5 text-xs" href={`/admin?tab=settings&group=${c.group}`}>{t("fixIt")}</Link>
              </div>
            ))}
          </div>
        </section>
      )}
      {advice.length > 0 && (
        <details className="card group" open={blocking.length === 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm">
            <Icon name="alert" className="h-4 w-4 text-warn" />
            <span className="flex-1 font-semibold">{t("advice", { n: advice.length })}</span>
            <span className="text-xs text-muted">{t("show")}</span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {advice.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm" data-check={c.id}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t(`check.${c.id}.title`)}{c.detail && <span className="ml-2 font-mono text-xs text-muted">{c.detail}</span>}</div>
                  <div className="text-xs text-muted">{t(`check.${c.id}.fix`)}</div>
                </div>
                <Link className="btn-ghost !px-3 !py-1 text-xs" href={`/admin?tab=settings&group=${c.group}`}>{t("fixIt")}</Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("metrics")}>
        <Kpi label={t("revenue30")} value={twd(stats.revenue30)} sub={t("revenue30Sub", { n: more.payments30, refunds: twd(stats.refunds30), r: more.refunds30Count })} />
        <Kpi label={t("subs")} value={stats.activeSubscriptions.toLocaleString("en-US")} sub={subsLine || t("subsNone")} />
        <Kpi
          label={t("relay")}
          value={t("calls", { n: stats.relayCalls24h.toLocaleString("en-US") })}
          tone={errRate !== null && errRate >= 5 ? "warn" : undefined}
          sub={t("relaySub", { err: errRate === null ? "—" : `${errRate}%`, cost: twd(stats.relayCost24h, 2) })}
        />
        <Kpi label={t("users")} value={stats.users.toLocaleString("en-US")} sub={t("usersSub", { n: more.newUsers7d })} />
      </section>

      <section className="card" aria-labelledby="inbox">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <h2 id="inbox" className="h3 mr-1">{t("inbox", { n: inbox.length })}</h2>
          <span className="text-xs text-muted">{t("inboxSort")}</span>
          <span className="flex-1" />
          {FILTERS.map((x) => (
            <FilterLink key={x} href={x === "all" ? "/admin" : `/admin?f=${x}`} on={f === x}>{t(`filter.${x}`)} {count(x)}</FilterLink>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="border-t border-line p-4"><Empty>{inbox.length ? t("inboxFilteredEmpty") : t("inboxEmpty")}</Empty></div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {rows.slice(0, 30).map((i) => {
              const ms = now.getTime() - i.since.getTime();
              return (
                <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" data-inbox={i.kind}>
                  <Tag tone={KIND_TONE[i.kind]}>{t(`kind.${i.kind}`)}</Tag>
                  <div className="min-w-0 flex-[1_1_280px]">
                    <div className="truncate text-sm font-semibold">{i.title}</div>
                    <div className="truncate text-xs text-muted">{t(`detail.${i.detail.key}`, i.detail.values ?? {})}</div>
                  </div>
                  <span className={`whitespace-nowrap text-xs ${ms > LATE_MS ? "font-semibold text-warn" : "text-muted"}`}>{t("waiting", { t: waited(ms, tw) })}</span>
                  <Link href={i.href} className="btn-ghost !px-3 !py-1.5 text-xs">{t(`act.${i.kind}`)}</Link>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > 30 && <p className="border-t border-line px-4 py-2 text-xs text-muted">{t("more", { n: rows.length - 30 })}</p>}
      </section>

      <section className="card" aria-labelledby="recent">
        <div className="flex items-center px-4 py-3">
          <h2 id="recent" className="h3 flex-1">{t("recent")}</h2>
          <Link href="/admin?tab=audit" className="text-sm text-accent">{t("allAudit")}</Link>
        </div>
        {recent.length === 0 ? (
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{ta("audit.empty")}</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line text-sm">
            {recent.map((a, i) => (
              <li key={a.id} className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 py-2.5">
                <span className="w-44 shrink-0 text-xs text-muted"><LocalDate value={a.createdAt} /></span>
                <span className="min-w-0 flex-1">{summaries[i]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {!superAdmin && <p className="text-xs text-muted">{t("adminNote")}</p>}
    </div>
  );
}
