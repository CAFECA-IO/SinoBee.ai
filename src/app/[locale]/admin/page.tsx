import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import { isAdminRole } from "@/lib/roles";
import { Icon } from "@/components/icon";
import { AdminNavSelect } from "@/components/admin/nav-select";
import { adminCounts } from "@/lib/admin-overview";
import { Overview } from "./_sections/overview";
import { Review } from "./_sections/review";
import { Reports } from "./_sections/reports";
import { Crowd } from "./_sections/crowd";
import { ChecklistAdmin } from "./_sections/checklist";
import { Users } from "./_sections/users";
import { Payments } from "./_sections/payments";
import { Plans } from "./_sections/plans";
import { Models } from "./_sections/models";
import { SiteSettings } from "./_sections/settings";
import { Audit } from "./_sections/audit";
import { StorageStatus } from "./_sections/storage";
import { navWarnings } from "./_sections/warnings";

export const dynamic = "force-dynamic";

/** 5 groups, 12 sections (admin rework 2026-10-21: related pages merged, every queue in the overview inbox) */
const NAV = [
  { group: "", items: [{ id: "overview", icon: "grid" }] },
  { group: "review", items: [{ id: "review", icon: "hub" }, { id: "reports", icon: "flag" }, { id: "crowd", icon: "users" }, { id: "checklist", icon: "list" }] },
  { group: "business", items: [{ id: "users", icon: "user" }, { id: "payments", icon: "card" }, { id: "plans", icon: "layers" }] },
  { group: "models", items: [{ id: "models", icon: "brain" }] },
  { group: "system", items: [{ id: "settings", icon: "gear" }, { id: "audit", icon: "list" }, { id: "storage", icon: "database" }] },
] as const;
const TABS = NAV.flatMap((g) => g.items.map((i) => i.id)) as string[];

/** Links and bookmarks from before the sections were merged */
const LEGACY: Record<string, Record<string, string>> = {
  pending: { tab: "review" },
  approved: { tab: "review", status: "approved" },
  tools: { tab: "review", kind: "tool" },
  screening: { tab: "crowd" },
  disputes: { tab: "crowd" },
  prices: { tab: "models" },
  ai: { tab: "models" },
};

export type AdminParams = Record<string, string | undefined>;

export default async function AdminPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<AdminParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me || !isAdminRole(me.role)) notFound();
  const sp = await searchParams;
  const raw = sp.tab ?? "overview";
  if (LEGACY[raw]) {
    const { tab: _drop, ...rest } = sp;
    redirect({ href: `/admin?${new URLSearchParams({ ...(rest as Record<string, string>), ...LEGACY[raw] })}`, locale });
  }
  const tab = TABS.includes(raw) ? raw : "overview";
  const t = await getTranslations("admin");
  const counts = await adminCounts();
  const warn = await navWarnings();
  const superAdmin = me.role === "SUPERADMIN";
  const badge: Record<string, { n: number; tone: "accent" | "warn" } | undefined> = {
    overview: { n: counts.pending + counts.tools + counts.reports + counts.payments + counts.disputes + counts.screening, tone: "accent" },
    review: { n: counts.pending + counts.tools, tone: "accent" },
    reports: { n: counts.reports, tone: "accent" },
    crowd: { n: counts.screening + counts.disputes, tone: "accent" },
    payments: { n: counts.payments, tone: "accent" },
    settings: { n: counts.settingsOpen, tone: "warn" },
    plans: warn.plans ? { n: warn.plans, tone: "warn" } : undefined,
    models: warn.models ? { n: warn.models, tone: "warn" } : undefined,
  };
  const groups = NAV.map((g) => ({
    group: g.group,
    label: g.group ? t(`nav.${g.group}`) : "",
    items: g.items.map((i) => ({ ...i, label: t(`tab.${i.id}`), href: i.id === "overview" ? "/admin" : `/admin?tab=${i.id}`, badge: badge[i.id] })),
  }));

  let body: React.ReactNode;
  if (tab === "overview") body = <Overview superAdmin={superAdmin} sp={sp} />;
  else if (tab === "review") body = <Review sp={sp} />;
  else if (tab === "reports") body = <Reports />;
  else if (tab === "crowd") body = <Crowd />;
  else if (tab === "checklist") body = <ChecklistAdmin />;
  else if (tab === "users") body = <Users me={me} superAdmin={superAdmin} sp={sp} />;
  else if (tab === "payments") body = <Payments sp={sp} />;
  else if (tab === "plans") body = <Plans sp={sp} />;
  else if (tab === "models") body = <Models sp={sp} />;
  else if (tab === "settings") body = <SiteSettings superAdmin={superAdmin} locale={locale} sp={sp} />;
  else if (tab === "storage") body = <StorageStatus />;
  else body = <Audit sp={sp} />;

  return (
    <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center gap-2 px-1">
          <Icon name="shield" />
          <span className="font-bold">{t("title")}</span>
          <span className="badge bg-panel-2 text-muted">{t(`users.role.${me.role}`)}</span>
        </div>
        <AdminNavSelect current={tab} label={t("title")} groups={groups.map((g) => ({ label: g.label, items: g.items.map((i) => ({ id: i.id, label: i.label, href: i.href, count: i.badge?.n })) }))} />
        <nav aria-label={t("title")} className="hidden space-y-4 lg:block">
          {groups.map((g) => (
            <div key={g.group || "start"}>
              {g.label && <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label}</div>}
              <ul className="space-y-0.5">
                {g.items.map((i) => {
                  const active = tab === i.id;
                  return (
                    <li key={i.id}>
                      <Link
                        href={i.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${active ? "bg-accent-soft font-semibold text-ink" : "text-muted hover:bg-panel-2 hover:text-ink"}`}
                      >
                        <Icon name={i.icon} className="h-4 w-4" />
                        <span className="flex-1">{i.label}</span>
                        {i.badge && i.badge.n > 0 && (
                          <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold ${i.badge.tone === "warn" ? "bg-warn-soft text-warn" : "bg-accent text-accent-ink"}`}>{i.badge.n}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 space-y-5">{body}</main>
    </div>
  );
}
