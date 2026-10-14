import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db, icontains } from "@/lib/db";
import type { ToolManifest } from "@/lib/tools/spec";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "tools" });
  return { title: t("title"), description: t("lead") };
}

const PAGE = 24;
const ENGINE: Record<string, string> = { postgres: "PostgreSQL", mysql: "MySQL / MariaDB", sqlite: "SQLite" };

export default async function ToolsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("tools");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { visibility: "PUBLIC" as const, versions: { some: { status: "APPROVED" as const, public: true } }, ...(q ? { OR: [{ name: icontains(q) }, { description: icontains(q) }] } : {}) };
  const [total, tools] = await Promise.all([
    db.tool.count({ where }),
    db.tool.findMany({ where, include: { owner: true, versions: { where: { status: "APPROVED", public: true }, orderBy: { publishedAt: "desc" }, take: 1 } }, orderBy: [{ installs: "desc" }, { updatedAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE }),
  ]);
  return (
    <div className="container-x py-12">
      <h1 className="h1">{t("title")}</h1>
      <p className="mt-2 max-w-2xl text-muted">{t("lead")}</p>
      <form className="mt-8 flex flex-wrap gap-3" action="">
        <input name="q" defaultValue={q} placeholder={t("search")} className="input max-w-md flex-1" />
        <button className="btn-ghost">{t("searchBtn")}</button>
      </form>
      {tools.length === 0 && <p className="mt-10 text-muted">{t("empty")}</p>}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((x) => {
          const m = x.versions[0]?.manifest as ToolManifest | undefined;
          return (
            <Link key={x.id} href={`/tools/${x.owner.publisher}/${x.name}`} className="card block space-y-2 p-5 transition hover:border-accent">
              <div className="flex items-center gap-2">
                <span className="chip">{m ? ENGINE[m.database.engine] : x.kind}</span>
                <span className="ml-auto text-xs text-muted">{t("installs", { n: x.installs })}</span>
              </div>
              <div className="font-semibold">{m?.title ?? x.name}</div>
              <div className="font-mono text-xs text-muted">{x.owner.publisher}/{x.name}@{x.versions[0]?.version}</div>
              <p className="line-clamp-3 text-sm text-muted">{x.description}</p>
            </Link>
          );
        })}
      </div>
      {total > PAGE * page && (
        <div className="mt-8">
          <Link href={`/tools?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`} className="btn-ghost">{t("more")}</Link>
        </div>
      )}
    </div>
  );
}
