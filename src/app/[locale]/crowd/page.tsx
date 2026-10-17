import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/components/status-badge";
import { CATEGORIES, sharePrice } from "@/lib/crowd/rules";
import { SORTS, listCampaigns } from "@/lib/crowd/explore";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "crowd.explore" });
  return { title: t("title"), description: t("lead", { price: 30 }) };
}

type SP = { view?: string; sort?: string; category?: string; q?: string };

export default async function CrowdExplore({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("crowd");
  const sp = await searchParams;
  const view = sp.view === "funded" ? "funded" : "open";
  const sort = (SORTS as readonly string[]).includes(sp.sort ?? "") ? sp.sort! : "ending";
  const items = await listCampaigns({ view, sort, category: sp.category, q: sp.q });
  const href = (patch: Partial<SP>) => {
    const next = { view, sort, category: sp.category, q: sp.q, ...patch };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
    return `/crowd${qs ? `?${qs}` : ""}`;
  };
  const left = (d: Date | null) => {
    if (!d) return "";
    const ms = d.getTime() - Date.now();
    return ms > 86400_000 ? t("explore.daysLeft", { n: Math.ceil(ms / 86400_000) }) : t("explore.hoursLeft", { n: Math.max(0, Math.ceil(ms / 3600_000)) });
  };
  return (
    <div className="container-x py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">{t("explore.title")}</h1>
          <p className="mt-2 max-w-2xl text-muted">{t("explore.lead", { price: sharePrice() })}</p>
        </div>
        <Link href="/crowd/new" className="btn-primary">{t("new")}</Link>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Link href={href({ view: "open" })} className={view === "open" ? "btn-primary !py-2" : "btn-ghost !py-2"}>{t("explore.open")}</Link>
        <Link href={href({ view: "funded" })} className={view === "funded" ? "btn-primary !py-2" : "btn-ghost !py-2"}>{t("explore.funded")}</Link>
        <form action="/crowd" className="ml-auto flex gap-2">
          <input type="hidden" name="view" value={view} />
          {sp.category && <input type="hidden" name="category" value={sp.category} />}
          <input className="input !py-2" name="q" defaultValue={sp.q ?? ""} placeholder={t("explore.search")} maxLength={100} />
          <button className="btn-ghost whitespace-nowrap !py-2">{t("explore.go")}</button>
        </form>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href={href({ category: undefined })} className={`chip ${!sp.category ? "!border-accent text-accent" : ""}`}>{t("explore.all")}</Link>
        {CATEGORIES.map((c) => (
          <Link key={c} href={href({ category: c })} className={`chip ${sp.category === c ? "!border-accent text-accent" : ""}`}>{t(`categories.${c}`)}</Link>
        ))}
      </div>
      {view === "open" && (
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {SORTS.map((s) => (
            <Link key={s} href={href({ sort: s })} className={sort === s ? "font-semibold text-accent" : "text-muted hover:text-ink"}>{t(`explore.sort.${s}`)}</Link>
          ))}
        </div>
      )}
      {items.length === 0 && <p className="card mt-6 p-8 text-center text-muted">{t("explore.empty")}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => (
          <Link key={c.id} href={`/tasks/${c.id}`} className="card flex flex-col gap-3 p-5 hover:border-accent">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold leading-snug">{c.title}</span>
              <StatusBadge status={c.status} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              {c.category && <span className="chip">{t(`categories.${c.category}` as "categories.other")}</span>}
              <span>{c.proposer}</span>
            </div>
            <div className="mt-auto space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full bg-accent" style={{ width: `${Math.min(100, (c.pledged / Math.max(1, c.goalTwd)) * 100)}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted">
                <span className="font-mono">NT${c.pledged.toLocaleString("en-US")} / {c.goalTwd.toLocaleString("en-US")}</span>
                <span>{t("explore.backers", { n: c.backers })}</span>
              </div>
              {view === "open" && <div className="text-xs text-muted">{left(c.deadlineAt)}</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
