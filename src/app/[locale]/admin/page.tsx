import { ScreeningActions, ScreeningResult } from "@/components/crowd";
import { TestModeSwitch } from "@/components/test-mode-switch";
import { ChecklistEditor } from "@/components/checklist-editor";
import { DIMENSIONS, MIN_ITEMS, currentChecklist, draftChecklist, publishedVersions } from "@/lib/crowd/checklist";
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
import { referenceBlended, formatPrice, pricesAt, pricingSettings, scheduledPrices } from "@/lib/models";
import { listPlans } from "@/lib/plans";
import { icontains } from "@/lib/db";
import { PaymentActions, PlanEditor, PriceEditor, PricingSettingsForm, RoleActions } from "@/components/admin-settings";
import { refundable } from "@/lib/payments";
import { settingsForAdmin } from "@/lib/settings/store";
import { CopyText, OenCheck, RotateHubKey, SettingsBoard, type SettingItem, type SettingsSection } from "@/components/admin-site-settings";
import { oenConfigured } from "@/lib/oen";
import { config } from "@/lib/config";
import { Icon } from "@/components/icon";
import { AiModelsAdmin } from "@/components/admin-ai";
import { modelCatalogFromApi, tierConfig } from "@/lib/ai-models";
import { adminCounts, adminStats, settingsHealth } from "@/lib/admin-overview";

export const dynamic = "force-dynamic";

const NAV = [
  { group: "start", items: [{ id: "overview", icon: "grid" }] },
  { group: "content", items: [{ id: "pending", icon: "hub", count: "pending" }, { id: "approved", icon: "check" }, { id: "tools", icon: "tool", count: "tools" }, { id: "reports", icon: "flag", count: "reports" }, { id: "disputes", icon: "flag", count: "disputes" }, { id: "screening", icon: "eye", count: "screening" }, { id: "checklist", icon: "list" }] },
  { group: "business", items: [{ id: "users", icon: "users" }, { id: "payments", icon: "card", count: "payments" }, { id: "plans", icon: "layers" }, { id: "prices", icon: "pricing" }, { id: "ai", icon: "brain" }] },
  { group: "system", items: [{ id: "settings", icon: "gear", count: "settings" }, { id: "audit", icon: "list" }, { id: "storage", icon: "database" }] },
] as const;
const TABS = NAV.flatMap((g) => g.items.map((i) => i.id));

export default async function AdminPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; q?: string; status?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me || !isAdminRole(me.role)) notFound();
  const t = await getTranslations("admin");
  const sp = await searchParams;
  const raw = sp.tab ?? "overview";
  const tab = (TABS as readonly string[]).includes(raw) ? raw : "overview";
  const counts = await adminCounts();
  const superAdmin = me.role === "SUPERADMIN";
  let body: React.ReactNode;
  if (tab === "overview") body = <Overview counts={counts} superAdmin={superAdmin} />;
  else if (tab === "pending" || tab === "approved") body = <SkillReviews tab={tab} />;
  else if (tab === "tools") body = <ToolReviews />;
  else if (tab === "storage") body = <StorageStatus />;
  else if (tab === "reports") body = <Reports />;
  else if (tab === "disputes") body = <Disputes />;
  else if (tab === "screening") body = <Screening />;
  else if (tab === "checklist") body = <ChecklistAdmin />;
  else if (tab === "users") body = <Users meId={me.id} superAdmin={superAdmin} q={sp.q} />;
  else if (tab === "payments") body = <Payments status={sp.status} />;
  else if (tab === "prices") body = <Prices />;
  else if (tab === "ai") body = <AiModels />;
  else if (tab === "plans") body = <Plans />;
  else if (tab === "settings") body = <SiteSettings superAdmin={superAdmin} locale={locale} />;
  else body = <Audit />;
  return (
    <div className="container-x grid grid-cols-1 gap-8 py-10 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <div className="mb-4 flex items-center gap-2">
          <Icon name="shield" />
          <span className="font-bold">{t("title")}</span>
          <span className="badge bg-panel-2 text-muted">{t(`users.role.${me.role}`)}</span>
        </div>
        <nav aria-label={t("title")} className="flex gap-4 overflow-x-auto pb-2 lg:block lg:space-y-5 lg:overflow-visible">
          {NAV.map((g) => (
            <div key={g.group} className="shrink-0">
              <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{t(`nav.${g.group}`)}</div>
              <ul className="flex gap-1 lg:flex-col">
                {g.items.map((i) => {
                  const n = "count" in i ? counts[i.count as keyof typeof counts] : 0;
                  const active = tab === i.id;
                  return (
                    <li key={i.id}>
                      <Link
                        href={i.id === "overview" ? "/admin" : `/admin?tab=${i.id}`}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active ? "bg-accent-soft font-semibold text-ink" : "text-muted hover:bg-panel-2 hover:text-ink"}`}
                      >
                        <Icon name={i.icon} className="h-4 w-4" />
                        <span className="flex-1">{t(`tab.${i.id}`)}</span>
                        {n > 0 && <span className={`rounded-full px-1.5 text-[11px] font-semibold ${i.id === "settings" ? "bg-warn-soft text-warn" : "bg-accent text-accent-ink"}`}>{n}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 space-y-6">
        <h1 className="h2">{t(`tab.${tab}`)}</h1>
        {body}
      </main>
    </div>
  );
}

async function SkillReviews({ tab }: { tab: "pending" | "approved" }) {
  const t = await getTranslations("admin");
  const versions = await db.skillVersion.findMany({
    where: tab === "pending" ? { status: "PENDING_REVIEW" } : { status: "APPROVED" },
    include: { skill: { include: { publisher: true } } },
    orderBy: { publishedAt: tab === "pending" ? "asc" : "desc" },
    take: 100,
  });
  const keys = hubPublicKeys();
  return (
    <div className="space-y-6">
      {!keys.length && <p className="rounded-xl bg-warn-soft p-4 text-sm text-warn">{t("noKey")}</p>}
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
            {r.targetType === "share" ? (
              <Link href={`/s/${r.targetId}`} className="font-mono text-accent">/s/{r.targetId}</Link>
            ) : r.targetType === "task" ? (
              <Link href={`/tasks/${r.targetId}`} className="font-mono text-accent">/tasks/{r.targetId}</Link>
            ) : (
              <ToolLink id={r.targetId} />
            )}
            <span className="text-xs text-muted">@{r.reporter.handle ?? r.reporter.account} · <LocalDate value={r.createdAt} /></span>
          </div>
          <p>{r.reason}</p>
          <ReportActions reportId={r.id} targetType={r.targetType} targetId={r.targetId} />
        </div>
      ))}
    </div>
  );
}

/** The public screening checklist: edit the draft by hand or with AI, publish versions */
async function ChecklistAdmin() {
  const t = await getTranslations("checklist");
  const [cur, draft, versions] = await Promise.all([currentChecklist(), draftChecklist(), publishedVersions()]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">{t("current", { v: cur.version, n: cur.items.length })}</span>
        <Link href="/crowd-terms" className="text-accent underline">/crowd-terms</Link>
      </div>
      <ChecklistEditor items={draft.items} dimensions={DIMENSIONS} min={MIN_ITEMS} version={cur.version} changed={draft.changed} />
      <div className="card space-y-2 p-5 text-sm">
        <div className="font-semibold">{t("history")}</div>
        {versions.map((v) => (
          <div key={v.version} className="flex flex-wrap gap-3">
            <span className="chip">v{v.version}</span>
            <span className="text-muted">{(v.items as unknown[]).length}</span>
            <span>{v.note}</span>
            {v.publishedAt && <span className="ml-auto text-xs text-muted"><LocalDate value={v.publishedAt} /></span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Proposals in screening, proposals sent back by it (re-review possible), and the latest results */
async function Screening() {
  const t = await getTranslations("admin");
  const tc = await getTranslations("crowd.screening");
  const waiting = await db.task.findMany({ where: { status: "SCREENING" }, include: { user: true }, orderBy: { updatedAt: "asc" }, take: 100 });
  const recent = await db.taskEvent.findMany({
    where: { type: { in: ["screening.rejected", "screening.passed", "funding.opened"] }, task: { crowdfund: true } },
    include: { task: { select: { id: true, title: true, status: true, screening: true, user: { select: { handle: true, account: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  // the newest result per proposal; sent-back ones can be re-reviewed while still in draft
  const seen = new Set<string>();
  const latest = recent.filter((e) => !(e.type === "funding.opened" && (e.data as { by?: string } | null)?.by === "ai") && !seen.has(e.taskId) && (seen.add(e.taskId), true));
  const sentBack = latest.filter((e) => e.type === "screening.rejected" && e.task.status === "DRAFT" && (e.task.screening as ScreeningData | null)?.decision === "rejected");
  const others = latest.filter((e) => !sentBack.includes(e));
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="h3">{tc("inProgress")} · {waiting.length}</h2>
        {waiting.length === 0 ? (
          <p className="text-muted">{t("empty")}</p>
        ) : (
          waiting.map((r) => {
            const sc = r.screening as ScreeningData | null;
            return (
              <div key={r.id} className="card space-y-3 p-5 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/tasks/${r.id}`} className="font-semibold text-accent">{r.title}</Link>
                  <span className="text-xs text-muted">@{r.user.handle ?? r.user.account} · NT${r.goalTwd ?? 0} · {r.selfFunded ? t("screening.self") : `${r.durationDays}d`} · <LocalDate value={r.updatedAt} /></span>
                </div>
                <p className="text-xs text-muted">{sc?.decision === "pending" ? tc("waiting") : tc("queued")}</p>
                {sc && <ScreeningResult screening={sc} />}
                <ScreeningActions taskId={r.id} />
              </div>
            );
          })
        )}
      </section>
      {sentBack.length > 0 && (
        <section className="space-y-3">
          <h2 className="h3">{tc("sentBack")} · {sentBack.length}</h2>
          {sentBack.map((e) => (
            <div key={e.id} className="card space-y-3 p-5 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-err">✗</span>
                <Link href={`/tasks/${e.task.id}`} className="font-semibold text-accent">{e.task.title}</Link>
                <span className="text-xs text-muted">@{e.task.user.handle ?? e.task.user.account} · <LocalDate value={e.createdAt} /></span>
              </div>
              <ScreeningResult screening={e.task.screening as ScreeningData} />
              <ScreeningActions taskId={e.task.id} />
            </div>
          ))}
        </section>
      )}
      {others.length > 0 && (
        <div className="card divide-y divide-line text-sm">
          {others.map((e) => {
            const d = e.data as { passed?: number; failed?: string[] | number; total?: number; v?: number } | null;
            const sc = e.task.screening as ScreeningData | null;
            const ok = e.type !== "screening.rejected";
            const failed = Array.isArray(d?.failed) ? d.failed.length : (d?.failed ?? 0);
            return (
              <div key={e.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className={ok ? "text-ok" : "text-err"}>{ok ? "✓" : "✗"}</span>
                <Link href={`/tasks/${e.task.id}`} className="text-accent">{e.task.title}</Link>
                {d?.total ? <span className="text-xs text-muted">{tc("result", { passed: d.passed ?? 0, failed, total: d.total, v: d.v ?? sc?.checklistVersion ?? 0 })}</span> : null}
                <span className="ml-auto text-xs text-muted"><LocalDate value={e.createdAt} /></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ScreeningData = { decision: string; passed?: number; failedCount?: number; total?: number; checklistVersion?: number; reasons: string[]; failed?: unknown[]; notes?: { text: string; at: string }[] };

/** Crowdfunded tasks whose acceptance review was rejected with no rework left */
async function Disputes() {
  const t = await getTranslations("admin");
  const rows = await db.task.findMany({ where: { status: "DISPUTED" }, include: { user: true }, orderBy: { updatedAt: "asc" }, take: 100 });
  if (!rows.length) return <p className="text-muted">{t("empty")}</p>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="card space-y-2 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/tasks/${r.id}`} className="font-semibold text-accent">{r.title}</Link>
            <span className="text-xs text-muted">@{r.user.handle ?? r.user.account} · NT${r.goalTwd ?? 0} · <LocalDate value={r.updatedAt} /></span>
          </div>
          {r.reworkNotes && <p className="whitespace-pre-wrap text-muted">{r.reworkNotes}</p>}
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

async function AiModels() {
  const [c, catalog, rows] = await Promise.all([tierConfig(), modelCatalogFromApi(), pricesAt(new Date(8.64e15))]);
  const providers = Object.keys(config.llm.providers);
  return (
    <AiModelsAdmin
      tiers={c.tiers}
      jobs={c.jobs}
      catalog={catalog}
      providers={providers}
      keyed={providers.filter((p) => !!config.llm.providers[p].key)}
      priced={Object.fromEntries(rows.map((m) => [m.modelId, m.enabled]))}
    />
  );
}

async function Prices() {
  const t = await getTranslations("admin.prices");
  const [rows, scheduled, s, plans, catalog] = await Promise.all([pricesAt(new Date()), scheduledPrices(), pricingSettings(), listPlans({ activeOnly: true }), modelCatalogFromApi()]);
  // offered models the provider's own model list does not have (they would fail with 404)
  const unknown = rows.filter((m) => {
    const [p, ...rest] = m.modelId.split("/");
    const c = catalog[p];
    return m.enabled && c && c.models.length > 0 && !c.models.some((x) => x.id === rest.join("/"));
  });
  return (
    <div className="space-y-6">
      {unknown.length > 0 && (
        <section className="card border-warn p-5 text-sm" role="alert">
          <p>{t("unknownIds", { models: unknown.map((m) => m.modelId).join(", ") })}</p>
        </section>
      )}
      <p className="text-sm text-muted">{t("syncHint")} <Link href="/admin?tab=ai" className="text-accent underline">{t("syncLink")}</Link></p>
      <section className="card space-y-3 p-5">
        <h2 className="h3">{t("formulaTitle")}</h2>
        <p className="text-sm text-muted">{t("formula", { fx: s.fx, buffer: s.buffer })}</p>
        <PricingSettingsForm fx={s.fx} buffer={s.buffer} planMultipliers={plans.map((p) => p.multiplier)} />
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
  const [plans, ref, s] = await Promise.all([listPlans(), referenceBlended(), pricingSettings()]);
  const blended = ref?.blendedTwd ?? 0;
  const label = ref?.model.label ?? "—";
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("help")}</p>
      {plans.map((p) => (
        <PlanEditor key={p.id} buffer={s.buffer} blended={blended} blendedLabel={label} plan={{ id: p.id, code: p.code, name: p.name, nameEn: p.nameEn, feeTwd: p.feeTwd, multiplier: p.multiplier, concurrency: p.concurrency, active: p.active, sortOrder: p.sortOrder }} />
      ))}
      <h2 className="h3 pt-4">{t("addPlan")}</h2>
      <PlanEditor buffer={s.buffer} blended={blended} blendedLabel={label} />
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
  const sums = await db.payment.aggregate({ where: { status: { in: ["CONFIRMED", "REFUNDED"] }, provider: { not: "TWDC" }, sandbox: false, confirmedAt: { gte: since } }, _sum: { amountTwd: true, refundedTwd: true }, _count: { _all: true } });
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
                <td className="p-3 text-xs">{ta(`pstatus.${p.status}`)}<div className="text-muted">{p.provider}{p.sandbox ? " · TEST" : ""}{p.providerStatus ? ` · ${p.providerStatus}` : ""}</div>{p.error && <div className="text-err">{p.error.slice(0, 80)}</div>}</td>
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
  const shown = items.filter((i) => !i.provider || i.provider === provider);
  const webhook = `${config.origin}/api/payments/oen/webhook`;
  const sections: SettingsSection[] = (["payments", "apiKeys", "llm", "legal", "cafeca", "pricing", "retention", "storage", "boltchain", "hub", "runner"] as const).map((g) => ({
    id: g,
    title: t(`group.${g}`),
    description: t(`groupHelp.${g}`),
    extra:
      g === "payments" ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel-2/50 px-4 py-3 text-sm">
          <span className="text-muted">{t("webhook")}</span>
          <code className="break-all font-mono text-xs">{webhook}</code>
          <CopyText text={webhook} />
          <span className="flex-1" />
          <OenCheck />
        </div>
      ) : g === "hub" && superAdmin ? (
        <div className="border-t border-line px-4 py-3"><RotateHubKey /></div>
      ) : undefined,
  }));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{superAdmin ? t("help") : t("readOnly")}</p>
      <p className="flex flex-wrap items-center gap-2 rounded-xl bg-panel-2 p-3 text-xs text-muted"><Icon name="shield" className="h-4 w-4" />{t("keyFile", { file: v.keyFile, fp: v.fingerprint })}</p>
      <SettingsBoard sections={sections} items={shown} canEdit={superAdmin} />
    </div>
  );
}

async function Overview({ counts, superAdmin }: { counts: Awaited<ReturnType<typeof adminCounts>>; superAdmin: boolean }) {
  const t = await getTranslations("admin.overview");
  const stats = await adminStats();
  const checks = settingsHealth();
  const tiles = [
    ["activeSubscriptions", stats.activeSubscriptions.toLocaleString("en-US")],
    ["revenue30", `NT$${stats.revenue30.toLocaleString("en-US")}`],
    ["refunds30", `NT$${stats.refunds30.toLocaleString("en-US")}`],
    ["relay24h", `${stats.relayCalls24h.toLocaleString("en-US")} · NT$${stats.relayCost24h.toFixed(2)}`],
    ["users", stats.users.toLocaleString("en-US")],
  ] as const;
  const todo = [
    ["pending", counts.pending],
    ["tools", counts.tools],
    ["reports", counts.reports],
    ["payments", counts.payments],
  ] as const;
  return (
    <div className="space-y-6">
      <TestModeSwitch on={config.testMode} canChange={superAdmin} />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {tiles.map(([k, v]) => (
          <div key={k} className="card p-4">
            <div className="text-xs text-muted">{t(`stat.${k}`)}</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{v}</div>
          </div>
        ))}
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="card">
          <h2 className="h3 p-4">{t("checklist")}</h2>
          <ul>
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 border-t border-line px-4 py-3 text-sm" data-check={c.id}>
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${c.ok ? "bg-accent-soft text-ok" : c.level === "error" ? "bg-err-soft text-err" : "bg-warn-soft text-warn"}`}>
                  <Icon name={c.ok ? "check" : "alert"} className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t(`check.${c.id}.title`)}{c.detail && <span className="ml-2 font-mono text-xs text-muted">{c.detail}</span>}</div>
                  {!c.ok && <div className="text-xs text-muted">{t(`check.${c.id}.fix`)}</div>}
                </div>
                {!c.ok && <Link href={`/admin?tab=settings#set-${c.group}`} className="btn-ghost !py-1 text-xs">{t("fix")}</Link>}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2 className="h3 p-4">{t("todo")}</h2>
          <ul>
            {todo.map(([k, n]) => (
              <li key={k} className="flex items-center gap-3 border-t border-line px-4 py-3 text-sm">
                <span className="flex-1">{t(`todoItem.${k}`)}</span>
                <span className={`font-mono font-semibold ${n ? "text-ink" : "text-muted"}`}>{n}</span>
                <Link href={`/admin?tab=${k}`} className="btn-ghost !py-1 text-xs">{t("open")}</Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
