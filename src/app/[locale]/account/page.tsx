import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { activeSubscription } from "@/lib/retention";
import { Link, redirect } from "@/i18n/navigation";
import { PublisherForm } from "@/components/publisher-form";
import { TokenManager } from "@/components/token-manager";
import { DeviceList } from "@/components/device-list";
import { SubscribeButton } from "@/components/subscribe-button";
import { LocalDate } from "@/components/date";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me) redirect({ href: "/login?next=/account", locale });
  const t = await getTranslations("account");
  const [sub, tokens, payments, skills, devices, tools, vault, packs, shares] = await Promise.all([
    activeSubscription(me!.id),
    db.apiToken.findMany({ where: { userId: me!.id, revokedAt: null, deviceId: null }, orderBy: { createdAt: "desc" } }),
    db.payment.findMany({ where: { userId: me!.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.skill.findMany({ where: { publisherId: me!.id }, include: { versions: { orderBy: { publishedAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
    db.device.findMany({ where: { userId: me!.id, revokedAt: null }, include: { tokens: { where: { revokedAt: null }, take: 1 } }, orderBy: { lastSeenAt: "desc" } }),
    db.tool.findMany({ where: { ownerId: me!.id }, include: { versions: { orderBy: { publishedAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
    db.vaultKey.findUnique({ where: { userId: me!.id } }),
    db.vaultPack.findMany({ where: { userId: me!.id }, orderBy: { name: "asc" } }),
    db.conversationShare.findMany({ where: { ownerId: me!.id, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
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
          <span className="text-muted">{t("channel")}</span>
          <span>{me!.channelId ? <span className="text-ok">{t("channelOpen")}</span> : <span className="text-warn">{t("channelClosed")}</span>}</span>
        </div>
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="h3">{t("publisher")}</h2>
        <p className="text-sm text-muted">{t("publisherHelp")}</p>
        <PublisherForm current={me!.publisher} />
      </section>

      <section id="subscription" className="card space-y-3 p-6">
        <h2 className="h3">{t("subscription")}</h2>
        {sub ? (
          <p className="text-sm">
            <span className="text-ok">✓ {t("subActive")}</span> — {t("until")} <LocalDate value={sub.endsAt} withTime={false} />
          </p>
        ) : (
          <p className="text-sm text-muted">{t("subNone", { days: config.retention.freeDays })}</p>
        )}
        <SubscribeButton price={config.subscription.priceTwdc} days={config.subscription.days} extend={!!sub} />
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
                <td className="py-2 font-mono">{Number(p.amount).toFixed(2)} TWD</td>
                <td className="py-2">{t(`pstatus.${p.status}`)}</td>
                <td className="max-w-[160px] truncate py-2 font-mono text-xs text-muted" title={p.txHash ?? ""}>{p.txHash ?? "—"}</td>
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
