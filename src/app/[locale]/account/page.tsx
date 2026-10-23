import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { subscriptionState } from "@/lib/subscriptions";
import { freePlan, listPlans } from "@/lib/plans";
import { Link, redirect } from "@/i18n/navigation";
import { PublisherForm } from "@/components/publisher-form";
import { TokenManager } from "@/components/token-manager";
import { DeviceList } from "@/components/device-list";
import { LocalDate } from "@/components/date";
import { StatusBadge } from "@/components/status-badge";
import { CardManager } from "@/components/crowd";
import { activeCards, cardOpt } from "@/lib/crowd/cards";
import { pointBalance, pointHistory } from "@/lib/crowd/points";
import { quotaContext, weekBudget, windowUse } from "@/lib/llm/quota";
import { autoRenewState } from "@/lib/auto-renew";
import { AutoRenewToggle } from "@/components/auto-renew-toggle";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me) redirect({ href: "/login?next=/account", locale });
  const t = await getTranslations("account");
  const [st, tokens, payments, skills, devices, tools, vault, packs, shares] = await Promise.all([
    subscriptionState(me!.id),
    db.apiToken.findMany({ where: { userId: me!.id, revokedAt: null, deviceId: null }, orderBy: { createdAt: "desc" } }),
    db.payment.findMany({ where: { userId: me!.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.skill.findMany({ where: { publisherId: me!.id }, include: { versions: { orderBy: { publishedAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
    db.device.findMany({ where: { userId: me!.id, revokedAt: null }, include: { tokens: { where: { revokedAt: null }, take: 1 } }, orderBy: { lastSeenAt: "desc" } }),
    db.tool.findMany({ where: { ownerId: me!.id }, include: { versions: { orderBy: { publishedAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
    db.vaultKey.findUnique({ where: { userId: me!.id } }),
    db.vaultPack.findMany({ where: { userId: me!.id }, orderBy: { name: "asc" } }),
    db.conversationShare.findMany({ where: { ownerId: me!.id, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const [plans, free] = await Promise.all([listPlans(), freePlan({ activeOnly: true })]);
  const tc = await getTranslations("crowd.account");
  const [points, pointRows, cards] = await Promise.all([pointBalance(me!.id), pointHistory(me!.id, 30), activeCards(me!.id)]);
  // level, this week's quota and automatic renewal
  const qc = await quotaContext(me!.id).catch(() => null);
  const wk = qc ? await weekBudget(qc) : null;
  const used = wk ? (await windowUse(me!.id, new Date(), wk.from)).w168 : 0;
  const renew = await autoRenewState(me!.id);
  const curPlan = st.current ? plans.find((x) => x.id === st.current!.planId || x.code === st.current!.plan) : undefined;
  const money = (n: number) => `NT$${(Math.round(n * 100) / 100).toLocaleString("en-US")}`;
  const planName = (id: string | null, code: string) => {
    const p = plans.find((x) => x.id === id || x.code === code);
    return p ? (locale.startsWith("zh") ? p.name : p.nameEn) : code;
  };
  return (
    <div className="container-x max-w-4xl space-y-8 py-12">
      <h1 className="h1">{t("title")}</h1>

      <section className="card space-y-2 p-6 text-sm">
        <h2 className="h3">{t("profile")}</h2>
        <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
          <span className="text-muted">{t("cafecaAccount")}</span>
          <span className="break-all font-mono">{me!.account}</span>
          <span className="text-muted">{t("handle")}</span>
          <span>{me!.handle ? `@${me!.handle}` : "—"}</span>
          <span className="text-muted">{t("kyc")}</span>
          <span>{me!.kycLevel != null ? `L${me!.kycLevel}` : "—"}</span>
        </div>
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="h3">{t("publisher")}</h2>
        <p className="text-sm text-muted">{t("publisherHelp")}</p>
        <PublisherForm current={me!.publisher} />
      </section>

      <section id="points" className="card space-y-3 p-6">
        <div className="flex items-center justify-between">
          <h2 className="h3">{tc("points")}</h2>
          <span className="text-xl font-extrabold text-accent">{tc("balance", { n: points })}</span>
        </div>
        <p className="text-sm text-muted">{tc("pointsNote")}</p>
        {pointRows.length === 0 ? (
          <p className="text-sm text-muted">{tc("noHistory")}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {pointRows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 text-xs text-muted"><LocalDate value={r.createdAt} /></td>
                  <td className="py-2">
                    {tc.has(`reason.${r.reason}`) ? tc(`reason.${r.reason}` as "reason.leftover") : r.reason}
                    {r.taskId && <> · <Link href={`/tasks/${r.taskId}`} className="text-accent">{r.note ?? "task"}</Link></>}
                    {!r.taskId && r.reason === "llm_usage" && r.note && <span className="text-muted"> · {r.note.split("/").slice(1).join("/") || r.note}</span>}
                  </td>
                  <td className={`py-2 text-right font-mono ${r.delta > 0 ? "text-ok" : ""}`}>{r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section id="cards" className="card space-y-3 p-6">
        <h2 className="h3">{tc("cards")}</h2>
        <p className="text-sm text-muted">{tc("cardsNote")}</p>
        <CardManager cards={cards.map(cardOpt)} />
      </section>

      <section id="subscription" className="card space-y-3 p-6">
        <h2 className="h3">{t("subscription")}</h2>
        {st.current ? (
          <p className="text-sm" data-sub="active">
            <span className="text-ok">✓ {t("subActive")}</span> {planName(st.current.planId, st.current.plan)} — {t("until")} <LocalDate value={st.endsAt!} withTime={false} />
            {st.upcoming.length > 0 && <span className="text-muted"> · {t("subStacked", { n: st.upcoming.length })}</span>}
          </p>
        ) : st.inGrace ? (
          <p className="text-sm text-warn" data-sub="grace">
            {t("subGrace")} <LocalDate value={st.graceEndsAt!} withTime={false} />
          </p>
        ) : (
          <p className="text-sm text-muted">{t("subNone", { days: config.retention.freeDays })}</p>
        )}
        {!st.current && free && <p className="text-sm" data-sub="free">{t("subFree", { plan: locale.startsWith("zh") ? free.name : free.nameEn, value: free.maxCostTwd.toLocaleString("en-US") })}</p>}
        {st.graceEndsAt && <p className="text-xs text-muted">{t("subKeep")} <LocalDate value={st.graceEndsAt} withTime={false} /></p>}
        {qc && (
          <p className="text-sm" id="level" data-level={qc.level.n}>
            {qc.level.n > 0 ? t("level", { n: qc.level.n, months: qc.level.months, bonus: Math.round(qc.level.bonus * 100) }) : t("levelNone")}
            {qc.level.next !== null && <span className="text-muted"> · {t("levelNext", { n: qc.level.n + 1, months: qc.level.next - qc.level.months })}</span>}
          </p>
        )}
        {wk && (
          <p className="text-sm" data-week>
            {t("week", { available: money(wk.availableTwd), used: money(used), grant: money(wk.grantTwd), carry: money(wk.carryInTwd), cap: money(wk.capTwd) })}{" "}
            <span className="text-muted">{t("weekNext")} <LocalDate value={wk.weekEnd} /></span>
          </p>
        )}
        {(st.current || renew.on) && <AutoRenewToggle on={renew.on} cardId={renew.cardId} cards={cards.map(cardOpt)} fee={curPlan?.feeTwd ?? null} />}
        <Link href="/subscribe" className="btn-primary">{st.current || st.upcoming.length ? t("extendPlan") : t("choosePlan")}</Link>
      </section>

      <section id="devices" className="card space-y-3 p-6">
        <h2 className="h3">{t("devices")}</h2>
        <p className="text-sm text-muted">{t("devicesHelp")}</p>
        <DeviceList devices={devices.map((d) => ({ id: d.id, name: d.name, platform: d.platform, createdAt: d.createdAt.toISOString(), lastSeenAt: d.lastSeenAt.toISOString(), scopes: d.tokens[0]?.scopes ?? "" }))} />
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="h3">{t("tokens")}</h2>
        <p className="text-sm text-muted">{t("tokensHelp")}</p>
        <TokenManager tokens={tokens.map((x) => ({ id: x.id, name: x.name, prefix: x.prefix, createdAt: x.createdAt.toISOString(), lastUsedAt: x.lastUsedAt?.toISOString() ?? null }))} />
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="h3">{t("mySkills")}</h2>
        {skills.length === 0 && <p className="text-sm text-muted">{t("noSkills")}</p>}
        {skills.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
            <Link href={`/skills/${me!.publisher}/${s.name}`} className="font-mono text-accent">{s.name}</Link>
            {s.versions[0] && (
              <span className="flex items-center gap-2">
                <span className="font-mono text-muted">v{s.versions[0].version}</span>
                <StatusBadge status={s.versions[0].status} />
              </span>
            )}
          </div>
        ))}
      </section>

      <section id="tools" className="card space-y-3 p-6">
        <h2 className="h3">{t("myTools")}</h2>
        <p className="text-sm text-muted">{t("myToolsHelp")}</p>
        {tools.length === 0 && <p className="text-sm text-muted">{t("noTools")}</p>}
        {tools.map((x) => (
          <div key={x.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link href={`/tools/${me!.publisher ?? me!.account}/${x.name}`} className="font-mono text-accent">{x.name}</Link>
            <span className="flex items-center gap-2">
              <span className="chip">{x.visibility === "PUBLIC" ? t("toolPublic") : t("toolPrivate")}</span>
              {x.versions[0] && <span className="font-mono text-muted">v{x.versions[0].version}</span>}
              {x.versions[0] && <StatusBadge status={x.versions[0].status} />}
            </span>
          </div>
        ))}
      </section>

      <section id="shares" className="card space-y-3 p-6">
        <h2 className="h3">{t("myShares")}</h2>
        <p className="text-sm text-muted">{t("mySharesHelp")}</p>
        {shares.length === 0 && <p className="text-sm text-muted">{t("noShares")}</p>}
        {shares.map((x) => (
          <div key={x.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link href={`/s/${x.id}`} className="text-accent">{x.title}</Link>
            <span className="flex items-center gap-2 text-xs text-muted">
              <span className="chip">{t(`shareVis.${x.visibility}`)}{x.restricted ? " 🔒" : ""}</span>
              {t("shareViews", { n: x.views })} · <LocalDate value={x.createdAt} withTime={false} />
            </span>
          </div>
        ))}
      </section>

      <section id="vault" className="card space-y-3 p-6">
        <h2 className="h3">{t("vault")}</h2>
        <p className="text-sm text-muted">{t("vaultHelp")}</p>
        {vault ? (
          <>
            <p className="text-sm"><span className="text-ok">✓ {t("vaultReady")}</span> <span className="font-mono text-xs text-muted">{vault.publicKey.slice(0, 16)}…</span></p>
            {packs.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="font-mono">{p.name}</span>
                <span className="text-xs text-muted">{t("packInfo", { size: p.size, rev: p.revision })} · <LocalDate value={p.updatedAt} /></span>
              </div>
            ))}
            {packs.length === 0 && <p className="text-sm text-muted">{t("noPacks")}</p>}
          </>
        ) : (
          <p className="text-sm text-muted">{t("vaultNone")}</p>
        )}
      </section>

      <section className="card overflow-x-auto p-6">
        <h2 className="h3">{t("payments")}</h2>
        <table className="mt-3 w-full min-w-[520px] text-sm">
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-2 text-muted"><LocalDate value={p.createdAt} /></td>
                <td className="py-2">{t(`purpose.${p.purpose}`)}</td>
                <td className="py-2 font-mono">{p.amountTwd ?? Number(p.amount).toFixed(2)} TWD{p.refundedTwd > 0 && <span className="text-xs text-muted"> ({t("refunded", { n: p.refundedTwd })})</span>}</td>
                <td className="py-2">{p.status === "PENDING" && p.checkoutUrl && p.checkoutExpiresAt && p.checkoutExpiresAt > new Date() ? <a className="text-accent underline" href={p.checkoutUrl}>{t("pstatus.PENDING")}</a> : t(`pstatus.${p.status}`)}</td>
                <td className="max-w-[160px] truncate py-2 font-mono text-xs text-muted" title={p.transactionHid ?? p.txHash ?? ""}>{p.transactionHid ?? p.txHash ?? "—"}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td className="py-2 text-muted">{t("noPayments")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
