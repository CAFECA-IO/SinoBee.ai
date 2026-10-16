import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { ReviewActions, VerifyPublisher } from "@/components/admin-actions";
import { StatusBadge } from "@/components/status-badge";
import { LocalDate } from "@/components/date";
import { hubPublicKeys } from "@/lib/skills/signing";
import { storageStatus } from "@/lib/boltchain/keeper";
import { ToolReview, ReportActions } from "@/components/admin-actions";
import type { ToolManifest } from "@/lib/tools/spec";
import { isAdminRole } from "@/lib/roles";
import { cheapestBlended, formatPrice, pricesAt, pricingSettings, scheduledPrices } from "@/lib/models";
import { listPlans } from "@/lib/plans";
import { icontains } from "@/lib/db";
import { PaymentActions, PlanEditor, PriceEditor, PricingSettingsForm, RoleActions } from "@/components/admin-settings";
import { refundable } from "@/lib/payments";
import { settingsForAdmin } from "@/lib/settings/store";
import { OenCheck, RotateHubKey, SettingsGroup, type SettingItem } from "@/components/admin-site-settings";
import { oenConfigured } from "@/lib/oen";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const TABS = ["pending", "approved", "tools", "reports", "users", "payments", "prices", "plans", "settings", "audit", "storage"] as const;

export default async function AdminPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; q?: string; status?: string }> }) {
  setRequestLocale((await params).locale);
  const me = await currentUser();
  if (!me || !isAdminRole(me.role)) notFound();
  const t = await getTranslations("admin");
  const sp = await searchParams;
  const raw = sp.tab ?? "pending";
  const tab = (TABS as readonly string[]).includes(raw) ? raw : "pending";
  const tabs = (
    <div className="flex flex-wrap gap-2">
      {TABS.map((k) => (
        <Link key={k} href={k === "pending" ? "/admin" : `/admin?tab=${k}`} className={tab === k ? "btn-primary" : "btn-ghost"}>{t(`tab.${k}`)}</Link>
      ))}
    </div>
  );
  if (tab !== "pending" && tab !== "approved")
    return (
      <div className="container-x space-y-6 py-12">
        <h1 className="h1">{t("title")}</h1>
        {tabs}
        {tab === "tools" && <ToolReviews />}
        {tab === "storage" && <StorageStatus />}
        {tab === "reports" && <Reports />}
        {tab === "users" && <Users meId={me.id} superAdmin={me.role === "SUPERADMIN"} q={sp.q} />}
        {tab === "payments" && <Payments status={sp.status} />}
        {tab === "prices" && <Prices />}
        {tab === "plans" && <Plans />}
        {tab === "settings" && <SiteSettings superAdmin={me.role === "SUPERADMIN"} locale={(await params).locale} />}
        {tab === "audit" && <Audit />}
      </div>
    );
  const versions = await db.skillVersion.findMany({
    where: tab === "pending" ? { status: "PENDING_REVIEW" } : { status: "APPROVED" },
    include: { skill: { include: { publisher: true } } },
    orderBy: { publishedAt: tab === "pending" ? "asc" : "desc" },
    take: 100,
  });
  const keys = hubPublicKeys();
  return (
    <div className="container-x space-y-6 py-12">
      <h1 className="h1">{t("title")}</h1>
      {!keys.length && <p className="rounded-xl bg-warn-soft p-4 text-sm text-warn">{t("noKey")}</p>}
      {tabs}
      {versions.length === 0 && <p className="text-muted">{t("empty")}</p>}
      <div className="space-y-4">
        {versions.map((v) => (
          <div key={v.id} className="card space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/skills/${v.skill.publisher.publisher}/${v.skill.name}?v=${v.version}`} className="font-mono font-semibold text-accent">
                {v.skill.publisher.publisher}/{v.skill.name}@{v.version}
              </Link>
              <StatusBadge status={v.status} />
              <span className={`badge ${v.scanVerdict === "CLEAN" ? "bg-accent-soft text-ok" : "bg-warn-soft text-warn"}`}>scan: {v.scanVerdict}</span>
              <span className="text-xs text-muted"><LocalDate value={v.publishedAt} /></span>
              <VerifyPublisher userId={v.skill.publisherId} verified={v.skill.publisher.publisherVerified} />
            </div>
            <p className="text-sm text-muted">{v.skill.description}</p>
            {(v.scanFindings as { file: string; rule: string; excerpt: string }[]).length > 0 && (
              <ul className="list-disc pl-5 text-xs text-warn">
                {(v.scanFindings as { file: string; rule: string; excerpt: string }[]).map((f, i) => (
                  <li key={i}>{f.file}: {f.rule} — {f.excerpt}</li>
                ))}
              </ul>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-accent">SKILL.md</summary>
              <pre className="codeblock mt-2 max-h-96 whitespace-pre-wrap">{v.skillMd}</pre>
            </details>
            <ReviewActions versionId={v.id} approved={v.status === "APPROVED"} />
          </div>
        ))}
      </div>
    </div>
  );
}

async function ToolReviews() {
  const t = await getTranslations("admin");
  const rows = await db.toolVersion.findMany({ where: { status: "PENDING_REVIEW" }, include: { tool: { include: { owner: true } } }, orderBy: { publishedAt: "asc" }, take: 100 });
  if (!rows.length) return <p className="text-muted">{t("empty")}</p>;
  return (
    <div className="space-y-4">
      {rows.map((v) => {
        const m = v.manifest as ToolManifest;
        return (
          <div key={v.id} className="card space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/tools/${v.tool.owner.publisher}/${v.tool.name}`} className="font-mono font-semibold text-accent">{v.tool.owner.publisher}/{v.tool.name}@{v.version}</Link>
              <span className="chip">{m.database.engine}</span>
              <span className="text-xs text-muted"><LocalDate value={v.publishedAt} /></span>
            </div>
            <p className="text-sm text-muted">{m.title} — {m.description}</p>
            {(v.scanFindings as { level: string; path: string; message: string }[]).length > 0 && (
              <ul className="list-disc pl-5 text-xs text-warn">
                {(v.scanFindings as { level: string; path: string; message: string }[]).map((f, i) => <li key={i}>{f.path}: {f.message}</li>)}
              </ul>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-accent">TOOL.json</summary>
              <pre className="codeblock mt-2 max-h-96 whitespace-pre-wrap">{JSON.stringify(m, null, 2)}</pre>
            </details>
            <ToolReview versionId={v.id} />
          </div>
        );
      })}
    </div>
  );
}

async function StorageStatus() {
  const t = await getTranslations("admin");
  const s = await storageStatus();
  const failing = await db.storageObject.findMany({ where: { error: { not: null }, status: { in: ["PENDING", "STORED"] } }, orderBy: { updatedAt: "desc" }, take: 20 });
  const anchors = await db.anchor.groupBy({ by: ["status"], _count: { _all: true } });
  const bolt = (wei?: string) => (wei ? (Number(BigInt(wei) / 10n ** 12n) / 1e6).toFixed(4) : "—");
  return (
    <div className="space-y-4">
      <section className="card space-y-2 p-6 text-sm">
        <h2 className="h3">Boltchain</h2>
        <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
          <span className="text-muted">{t("st.enabled")}</span><span>{s.enabled ? "✓" : t("st.off")}</span>
          {"wallet" in s && (<><span className="text-muted">{t("st.wallet")}</span><span className="break-all font-mono">{s.wallet}</span><span className="text-muted">{t("st.balance")}</span><span className="font-mono">{bolt(s.balance)} BOLT</span><span className="text-muted">epoch</span><span className="font-mono">{s.epoch}</span></>)}
          {"low" in s && s.low && (<><span className="text-muted">⚠</span><span className="text-warn">{t("st.low")}</span></>)}
          {"error" in s && (<><span className="text-muted">{t("st.error")}</span><span className="text-err">{s.error}</span></>)}
          <span className="text-muted">{t("st.certificates")}</span><span className="break-all font-mono">{s.certificates ?? "—"}</span>
        </div>
      </section>
      <section className="card p-6 text-sm">
        <h2 className="h3">{t("st.objects")}</h2>
        <table className="mt-3 w-full">
          <tbody>
            {s.groups.map((g) => (
              <tr key={g.status} className="border-t border-line"><td className="py-2">{g.status}</td><td className="py-2 font-mono">{g._count._all}</td><td className="py-2 font-mono text-muted">{String(g._sum.size ?? 0)} B</td></tr>
            ))}
            {anchors.map((g) => (
              <tr key={`a-${g.status}`} className="border-t border-line"><td className="py-2">{t("st.anchors")} · {g.status}</td><td className="py-2 font-mono">{g._count._all}</td><td /></tr>
            ))}
          </tbody>
        </table>
      </section>
      {failing.length > 0 && (
        <section className="card p-6 text-sm">
          <h2 className="h3">{t("st.errors")}</h2>
          {failing.map((o) => <div key={o.key} className="border-t border-line py-2"><span className="font-mono">{o.key}</span> <span className="text-err">{o.error}</span></div>)}
        </section>
      )}
    </div>
  );
}

async function Reports() {
  const t = await getTranslations("admin");
  const rows = await db.report.findMany({ where: { resolvedAt: null }, include: { reporter: true }, orderBy: { createdAt: "asc" }, take: 100 });
  if (!rows.length) return <p className="text-muted">{t("empty")}</p>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="card space-y-2 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="chip">{r.targetType}</span>
            {r.targetType === "share" ? <Link href={`/s/${r.targetId}`} className="font-mono text-accent">/s/{r.targetId}</Link> : <ToolLink id={r.targetId} />}
            <span className="text-xs text-muted">@{r.reporter.handle ?? r.reporter.account} · <LocalDate value={r.createdAt} /></span>
          </div>
          <p>{r.reason}</p>
          <ReportActions reportId={r.id} targetType={r.targetType} targetId={r.targetId} />
        </div>
      ))}
    </div>
  );
}

async function ToolLink({ id }: { id: string }) {
  const t = await db.tool.findUnique({ where: { id }, include: { owner: true } });
  if (!t) return <span className="font-mono">{id}</span>;
  return <Link href={`/tools/${t.owner.publisher ?? t.owner.account}/${t.name}`} className="font-mono text-accent">{t.owner.publisher}/{t.name}</Link>;
}

async function Users({ meId, superAdmin, q }: { meId: string; superAdmin: boolean; q?: string }) {
  const t = await getTranslations("admin.users");
  const query = q?.trim();
  const where = query ? { OR: [{ account: icontains(query.toLowerCase()) }, { handle: icontains(query) }, { publisher: icontains(query) }] } : {};
  const [staff, users] = await Promise.all([
    db.user.findMany({ where: { role: { in: ["SUPERADMIN", "ADMIN"] } }, orderBy: [{ role: "desc" }, { createdAt: "asc" }] }),
    db.user.findMany({ where: { ...where, role: "USER" }, orderBy: { lastLoginAt: "desc" }, take: 50 }),
  ]);
  const row = (u: (typeof users)[number]) => (
    <div key={u.id} className="flex flex-wrap items-center gap-3 border-t border-line p-4 text-sm" data-user={u.account}>
      <span className={`badge ${u.role === "USER" ? "bg-panel-2 text-muted" : "bg-accent-soft text-ok"}`}>{t(`role.${u.role}`)}</span>
      <span className="font-medium">@{u.handle ?? u.publisher ?? "—"}</span>
      <span className="break-all font-mono text-xs text-muted">{u.account}</span>
      <span className="text-xs text-muted">{t("lastLogin")} <LocalDate value={u.lastLoginAt} /></span>
      {u.id === meId && <span className="chip">{t("you")}</span>}
      <span className="flex-1" />
      {superAdmin && u.id !== meId && <RoleActions userId={u.id} account={u.account} role={u.role} />}
    </div>
  );
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{superAdmin ? t("helpSuper") : t("helpAdmin")}</p>
      <section className="card">
        <h2 className="h3 p-4">{t("staff")}</h2>
        {staff.map(row)}
      </section>
      <section className="card">
        <form className="flex flex-wrap items-center gap-2 p-4" action="" method="get">
          <input type="hidden" name="tab" value="users" />
          <h2 className="h3 mr-auto">{t("users")}</h2>
          <input className="input w-72" name="q" defaultValue={query} placeholder={t("search")} aria-label={t("search")} />
          <button className="btn-ghost">{t("searchGo")}</button>
        </form>
        {users.length ? users.map(row) : <p className="border-t border-line p-4 text-sm text-muted">{t("none")}</p>}
      </section>
    </div>
  );
}

async function Prices() {
  const t = await getTranslations("admin.prices");
  const [rows, scheduled, s] = await Promise.all([pricesAt(new Date()), scheduledPrices(), pricingSettings()]);
  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-5">
        <h2 className="h3">{t("formulaTitle")}</h2>
        <p className="text-sm text-muted">{t("formula", { fx: s.fx, buffer: s.buffer })}</p>
        <PricingSettingsForm fx={s.fx} buffer={s.buffer} />
      </section>
      {scheduled.length > 0 && (
        <section className="card p-5 text-sm">
          <h2 className="h3">{t("scheduled")}</h2>
          {scheduled.map((m) => (
            <div key={m.rowId} className="flex flex-wrap gap-3 border-t border-line py-2">
              <span className="font-mono text-xs">{m.modelId}</span>
              <span>{m.enabled ? "" : t("withdrawn")}</span>
              <span className="font-mono">{formatPrice(m.twd.input)} / {formatPrice(m.twd.cacheRead)} / {formatPrice(m.twd.cacheWrite)} / {formatPrice(m.twd.output)}</span>
              <span className="text-muted"><LocalDate value={m.effectiveAt} /></span>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <div className="flex flex-wrap items-baseline gap-3 p-4">
          <h2 className="h3">{t("models")}</h2>
          <span className="text-xs text-muted">{t("modelsHelp")}</span>
        </div>
        {rows.map((m) => (
          <PriceEditor key={m.rowId} fx={s.fx} buffer={s.buffer} row={{ modelId: m.modelId, label: m.label, vendor: m.vendor, usd: m.usd, enabled: m.enabled, sortOrder: m.sortOrder }} />
        ))}
        <div className="border-t border-line p-4 text-sm font-semibold">{t("addModel")}</div>
        <PriceEditor fx={s.fx} buffer={s.buffer} isNew />
      </section>
    </div>
  );
}

async function Plans() {
  const t = await getTranslations("admin.plans");
  const [plans, cheap] = await Promise.all([listPlans(), cheapestBlended()]);
  const blended = cheap?.blendedTwd ?? 0;
  const label = cheap?.model.label ?? "—";
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("help")}</p>
      {plans.map((p) => (
        <PlanEditor key={p.id} blended={blended} blendedLabel={label} plan={{ id: p.id, code: p.code, name: p.name, nameEn: p.nameEn, feeTwd: p.feeTwd, multiplier: p.multiplier, concurrency: p.concurrency, active: p.active, sortOrder: p.sortOrder }} />
      ))}
      <h2 className="h3 pt-4">{t("addPlan")}</h2>
      <PlanEditor blended={blended} blendedLabel={label} />
    </div>
  );
}

async function Audit() {
  const t = await getTranslations("admin.audit");
  const rows = await db.adminAudit.findMany({ include: { actor: true }, orderBy: { createdAt: "desc" }, take: 200 });
  if (!rows.length) return <p className="text-muted">{t("empty")}</p>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-muted">
          <tr><th className="p-3">{t("when")}</th><th className="p-3">{t("who")}</th><th className="p-3">{t("action")}</th><th className="p-3">{t("target")}</th><th className="p-3">{t("detail")}</th></tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-line align-top">
              <td className="whitespace-nowrap p-3 text-xs text-muted"><LocalDate value={a.createdAt} /></td>
              <td className="p-3 text-xs">{a.actor ? `@${a.actor.handle ?? a.actor.publisher ?? a.actor.account.slice(0, 10)}` : "—"}</td>
              <td className="p-3 font-mono text-xs">{a.action}</td>
              <td className="p-3 font-mono text-xs">{a.targetType ? `${a.targetType}:${a.targetId}` : ""}</td>
              <td className="max-w-md p-3"><code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs text-muted">{a.detail ? JSON.stringify(a.detail) : ""}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PAY_STATUSES = ["PENDING", "CONFIRMED", "FAILED", "EXPIRED", "REFUNDED"] as const;

async function Payments({ status }: { status?: string }) {
  const t = await getTranslations("admin.payments");
  const ta = await getTranslations("account");
  const st = (PAY_STATUSES as readonly string[]).includes(status ?? "") ? (status as (typeof PAY_STATUSES)[number]) : undefined;
  const rows = await db.payment.findMany({ where: st ? { status: st } : {}, include: { user: true }, orderBy: { createdAt: "desc" }, take: 100 });
  const since = new Date(Date.now() - 30 * 86400_000);
  const sums = await db.payment.aggregate({ where: { status: { in: ["CONFIRMED", "REFUNDED"] }, provider: { not: "TWDC" }, confirmedAt: { gte: since } }, _sum: { amountTwd: true, refundedTwd: true }, _count: { _all: true } });
  const refundables = await Promise.all(rows.map((p) => refundable(p)));
  return (
    <div className="space-y-4">
      <section className="card grid gap-3 p-5 text-sm sm:grid-cols-4">
        <div><div className="text-xs text-muted">{t("mode")}</div><div className="font-mono">{config.payments.mode === "mock" ? "mock" : `oen · ${config.oen.env}`}</div></div>
        <div><div className="text-xs text-muted">{t("merchant")}</div><div className="font-mono">{config.oen.merchantId || "—"} {oenConfigured() ? "✓" : <span className="text-err">{t("notConfigured")}</span>}</div></div>
        <div><div className="text-xs text-muted">{t("last30")}</div><div className="font-mono">NT${(sums._sum.amountTwd ?? 0).toLocaleString("en-US")} · {sums._count._all}</div></div>
        <div><div className="text-xs text-muted">{t("refunded30")}</div><div className="font-mono">NT${(sums._sum.refundedTwd ?? 0).toLocaleString("en-US")}</div></div>
      </section>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin?tab=payments" className={!st ? "chip !border-accent" : "chip"}>{t("all")}</Link>
        {PAY_STATUSES.map((s) => <Link key={s} href={`/admin?tab=payments&status=${s}`} className={st === s ? "chip !border-accent" : "chip"}>{ta(`pstatus.${s}`)}</Link>)}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-muted"><tr><th className="p-3">{t("when")}</th><th className="p-3">{t("user")}</th><th className="p-3">{t("what")}</th><th className="p-3 text-right">TWD</th><th className="p-3">{t("status")}</th><th className="p-3">Oen</th><th className="p-3" /></tr></thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.id} className="border-t border-line align-top" data-payment={p.id}>
                <td className="whitespace-nowrap p-3 text-xs text-muted"><LocalDate value={p.createdAt} /></td>
                <td className="p-3 text-xs">@{p.user.handle ?? p.user.publisher ?? p.user.account.slice(0, 10)}</td>
                <td className="p-3 text-xs">{ta(`purpose.${p.purpose}`)}{p.taskId && <> · <Link href={`/tasks/${p.taskId}`} className="text-accent">task</Link></>}</td>
                <td className="p-3 text-right font-mono">{p.amountTwd ?? Number(p.amount).toFixed(2)}{p.refundedTwd > 0 && <div className="text-xs text-warn">−{p.refundedTwd}</div>}</td>
                <td className="p-3 text-xs">{ta(`pstatus.${p.status}`)}<div className="text-muted">{p.provider}{p.providerStatus ? ` · ${p.providerStatus}` : ""}</div>{p.error && <div className="text-err">{p.error.slice(0, 80)}</div>}</td>
                <td className="p-3 font-mono text-xs">{p.transactionHid ?? p.txHash?.slice(0, 12) ?? "—"}</td>
                <td className="p-3"><PaymentActions id={p.id} refundable={refundables[i]} provider={p.provider} status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{t("help")}</p>
    </div>
  );
}

async function SiteSettings({ superAdmin, locale }: { superAdmin: boolean; locale: string }) {
  const t = await getTranslations("admin.settings");
  const v = settingsForAdmin();
  const zh = locale.startsWith("zh");
  const items: SettingItem[] = v.items.map((i) => ({ ...i, label: zh ? i.label.zh : i.label.en, help: i.help ? (zh ? i.help.zh : i.help.en) : undefined }));
  const provider = items.find((i) => i.key === "payments.provider")?.value ?? "oen";
  const of = (g: string) => items.filter((i) => i.group === g && (!i.provider || i.provider === provider));
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{superAdmin ? t("help") : t("readOnly")}</p>
      <p className="rounded-xl bg-panel-2 p-3 text-xs text-muted">{t("keyFile", { file: v.keyFile, fp: v.fingerprint })}</p>
      <SettingsGroup title={t("group.payments")} items={of("payments")} canEdit={superAdmin}>
        <div className="flex flex-wrap items-center gap-3 border-t border-line p-4 text-sm">
          <span className="text-muted">{t("webhook")}</span>
          <code className="break-all font-mono text-xs">{config.origin}/api/payments/oen/webhook</code>
          <OenCheck />
        </div>
      </SettingsGroup>
      {(["apiKeys", "llm", "cafeca", "legal", "pricing", "retention", "storage", "boltchain", "hub", "runner"] as const).map((g) => (
        <SettingsGroup key={g} title={t(`group.${g}`)} items={of(g)} canEdit={superAdmin}>
          {g === "hub" && superAdmin && <div className="border-t border-line p-4"><RotateHubKey /></div>}
        </SettingsGroup>
      ))}
    </div>
  );
}
