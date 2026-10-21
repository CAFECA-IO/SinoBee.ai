import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { oenConfigured } from "@/lib/oen";
import { refundable } from "@/lib/payments";
import { LocalDate } from "@/components/date";
import { PAY_PERIODS, PAY_STATUSES, type PayStatus, paymentList } from "@/lib/admin/payments";
import { PaymentRefund, PaymentSync } from "@/components/admin/payment-actions";
import { Banner, DetailPanel, Empty, FilterLink, KV, PageHead, PanelSection, Split, Tag, adminHref, twd, waited } from "@/components/admin/kit";
import type { AdminParams } from "../page";

const TONE = { CONFIRMED: "ok", PENDING: "warn", FAILED: "err", EXPIRED: "muted", REFUNDED: "info" } as const;
const STALE_MS = 15 * 60_000;

export async function Payments({ sp }: { sp: AdminParams }) {
  const t = await getTranslations("admin.pay");
  const tp = await getTranslations("admin.payments");
  const ta = await getTranslations("admin");
  const tacc = await getTranslations("account");
  const tw = await getTranslations("admin.wait");
  const to = await getTranslations("admin.ov");
  const status = (PAY_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as PayStatus) : undefined;
  const days = PAY_PERIODS.includes(Number(sp.days) as (typeof PAY_PERIODS)[number]) ? Number(sp.days) : 30;
  const q = sp.q?.trim() || undefined;
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86400_000);
  const [list, sums, stale] = await Promise.all([
    paymentList({ status, q, days: days || undefined }, now),
    db.payment.aggregate({ where: { status: { in: ["CONFIRMED", "REFUNDED"] }, provider: { not: "TWDC" }, sandbox: false, confirmedAt: { gte: since } }, _sum: { amountTwd: true, refundedTwd: true }, _count: { _all: true } }),
    db.payment.findMany({ where: { status: "PENDING", provider: { not: "TWDC" }, createdAt: { lt: new Date(now.getTime() - STALE_MS) } }, include: { user: true }, orderBy: { createdAt: "asc" }, take: 5 }),
  ]);
  const base = { tab: "payments", status, q, days: days === 30 ? undefined : String(days) };
  const exportQs = new URLSearchParams(Object.entries({ status, q, days: days ? String(days) : undefined }).filter((e): e is [string, string] => !!e[1])).toString();
  const sel = sp.id ? await db.payment.findUnique({ where: { id: sp.id }, include: { user: true } }) : null;
  const handle = (u: { handle: string | null; publisher: string | null; account: string }) => u.handle ?? u.publisher ?? u.account.slice(0, 10);

  let panel: React.ReactNode = null;
  if (sel) {
    const [max, sub, card, task, plan] = await Promise.all([
      refundable(sel),
      db.subscription.findUnique({ where: { paymentId: sel.id } }),
      sel.cardId ? db.savedCard.findUnique({ where: { id: sel.cardId } }) : null,
      sel.taskId ? db.task.findUnique({ where: { id: sel.taskId }, select: { id: true, title: true } }) : null,
      sel.planId ? db.plan.findUnique({ where: { id: sel.planId } }) : null,
    ]);
    const effect = sel.purpose === "SUBSCRIPTION" ? t("effectSub", { user: handle(sel.user) }) : sel.purpose === "CROWD_PLEDGE" ? t("effectPledge") : t("effectOther");
    panel = (
      <DetailPanel
        title={<span className="flex flex-wrap items-center gap-2">{twd(sel.amountTwd ?? 0)} · {tacc(`purpose.${sel.purpose}`)}{plan ? ` ${plan.name}` : ""} <Tag tone={TONE[sel.status]}>{tacc(`pstatus.${sel.status}`)}</Tag></span>}
        sub={<><Link href={`/admin?tab=users&q=${encodeURIComponent(sel.user.account)}`} className="text-accent">@{handle(sel.user)}</Link> · <LocalDate value={sel.createdAt} /></>}
        closeHref={adminHref(base, { id: undefined })}
        closeLabel={t("close")}
      >
        <PanelSection>
          <KV
            rows={[
              [t("transaction"), <span key="tx" className="font-mono">{sel.transactionHid ?? sel.oenId ?? "—"}</span>],
              [t("provider"), `${sel.provider}${sel.sandbox ? " · TEST" : ""}${sel.providerStatus ? ` · ${sel.providerStatus}` : ""}`],
              ...(card ? [[t("card"), `${card.brand ?? ""} •••• ${card.last4 ?? "—"}`] as [string, string]] : []),
              ...(sub ? [[t("period"), `${sub.startsAt.toISOString().slice(0, 10)} – ${sub.endsAt.toISOString().slice(0, 10)}${sub.cancelledAt ? ` · ${t("cancelled")}` : ""}`] as [string, string]] : []),
              ...(task ? [[t("task"), <Link key="task" href={`/tasks/${task.id}`} className="text-accent">{task.title}</Link>] as [string, React.ReactNode]] : []),
              ...(sel.confirmedAt ? [[t("confirmedAt"), <LocalDate key="c" value={sel.confirmedAt} />] as [string, React.ReactNode]] : []),
              ...(sel.refundedTwd > 0 ? [[t("refunded"), `${twd(sel.refundedTwd)}${sel.refundReason ? ` · ${sel.refundReason}` : ""}`] as [string, string]] : []),
              ...(sel.error ? [[t("error"), <span key="e" className="text-err">{sel.error}</span>] as [string, React.ReactNode]] : []),
            ]}
          />
        </PanelSection>
        {sel.status === "PENDING" && sel.provider === "OEN" && (
          <PanelSection title={t("pendingTitle")}>
            <p className="text-muted">{t("pendingHelp")}</p>
            <PaymentSync id={sel.id} />
          </PanelSection>
        )}
        {max > 0 ? (
          <PanelSection title={t("refundTitle")}>
            <p className="text-muted">{t("refundRules")}</p>
            <PaymentRefund id={sel.id} max={max} effect={effect} />
          </PanelSection>
        ) : (
          sel.status === "CONFIRMED" && <PanelSection title={t("refundTitle")}><p className="text-muted">{sel.purpose === "CROWD_PROPOSAL" ? t("noRefundProposal") : t("noRefund")}</p></PanelSection>
        )}
      </DetailPanel>
    );
  }

  const table = (
    <section className="card overflow-hidden">
      {list.rows.length === 0 ? (
        <div className="p-4"><Empty>{t("none")}</Empty></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-medium">{tp("when")}</th>
                <th className="px-4 py-2.5 font-medium">{tp("user")}</th>
                <th className="px-4 py-2.5 font-medium">{tp("what")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("amountCol")}</th>
                <th className="px-4 py-2.5 font-medium">{tp("status")}</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((p) => (
                <tr key={p.id} className={`border-b border-line last:border-0 ${p.id === sp.id ? "bg-accent-soft" : "hover:bg-panel-2"}`} data-payment={p.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted"><Link href={adminHref(base, { id: p.id })} className="hover:text-ink"><LocalDate value={p.createdAt} /></Link></td>
                  <td className="px-4 py-2.5 font-medium"><Link href={adminHref(base, { id: p.id })}>@{handle(p.user)}</Link></td>
                  <td className="px-4 py-2.5">{tacc(`purpose.${p.purpose}`)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{(p.amountTwd ?? 0).toLocaleString("en-US")}{p.refundedTwd > 0 && <div className="text-xs text-warn">−{p.refundedTwd.toLocaleString("en-US")}</div>}</td>
                  <td className="px-4 py-2.5">
                    <Tag tone={TONE[p.status]}>{tacc(`pstatus.${p.status}`)}</Tag>
                    {p.sandbox && <Tag tone="warn" className="ml-1">TEST</Tag>}
                    {p.error && <div className="mt-0.5 max-w-56 truncate text-xs text-err" title={p.error}>{p.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.rows.length >= 100 && <p className="border-t border-line px-4 py-2 text-xs text-muted">{t("first100")}</p>}
    </section>
  );

  return (
    <div className="space-y-4">
      <PageHead
        title={ta("tab.payments")}
        sub={t("summary", { amount: twd(sums._sum.amountTwd ?? 0), n: sums._count._all, refunded: twd(sums._sum.refundedTwd ?? 0) })}
      >
        {config.payments.mode === "mock" ? <Tag tone="warn">mock</Tag> : !oenConfigured() ? <Link href="/admin?tab=settings&group=payments" className="text-sm text-err">{to("check.payments.title")}</Link> : <Tag tone="ok">Oen · {config.oen.env}</Tag>}
      </PageHead>
      {stale.length > 0 && (
        <Banner tone="warn" title={t("stale", { n: stale.length })} action={stale.length === 1 ? <PaymentSync id={stale[0].id} /> : <Link className="btn-ghost !py-1.5" href={adminHref({ tab: "payments" }, { status: "PENDING" })}>{t("showPending")}</Link>}>
          {stale.slice(0, 3).map((p) => t("staleRow", { user: handle(p.user), amount: twd(p.amountTwd ?? 0), ago: waited(now.getTime() - p.createdAt.getTime(), tw) })).join("；")}
        </Banner>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <form action="" method="get" className="flex gap-2">
          <input type="hidden" name="tab" value="payments" />
          {status && <input type="hidden" name="status" value={status} />}
          {base.days && <input type="hidden" name="days" value={base.days} />}
          <input className="input !w-64 !py-2" name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} />
        </form>
        <FilterLink href={adminHref(base, { status: undefined, id: undefined })} on={!status}>{tp("all")} {list.total}</FilterLink>
        {PAY_STATUSES.map((s) => (
          <FilterLink key={s} href={adminHref(base, { status: s, id: undefined })} on={status === s}>{tacc(`pstatus.${s}`)} {list.counts[s]}</FilterLink>
        ))}
        <span className="flex-1" />
        <label className="sr-only" htmlFor="period">{t("period")}</label>
        <div className="flex gap-1" id="period">
          {PAY_PERIODS.map((d) => (
            <FilterLink key={d} href={adminHref(base, { days: d === 30 ? undefined : String(d), id: undefined })} on={days === d}>{d ? t("days", { n: d }) : t("allTime")}</FilterLink>
          ))}
        </div>
        <a className="btn-ghost !py-1.5 text-xs" href={`/api/admin/payments/export${exportQs ? `?${exportQs}` : ""}`}>{t("csv")}</a>
      </div>
      <Split list={table} detail={panel} />
      <p className="text-xs text-muted">{tp("help")}</p>
    </div>
  );
}
