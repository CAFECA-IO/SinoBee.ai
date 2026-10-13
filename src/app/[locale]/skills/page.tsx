import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db, icontains } from "@/lib/db";
import { SkillCard } from "@/components/skill-card";
import { Toggle } from "@/components/toggle";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "skills" });
  return { title: "Skill Hub", description: t("lead") };
}

const PAGE = 24;
const SORTS: Record<string, Prisma.SkillOrderByWithRelationInput[]> = { popular: [{ downloads: "desc" }], rating: [{ ratingAvg: "desc" }, { ratingCount: "desc" }], new: [{ createdAt: "desc" }] };

export default async function SkillsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; tag?: string; sort?: string; page?: string; verified?: string }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("skills");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const sort = sp.sort && sp.sort in SORTS ? sp.sort : "popular";
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.SkillWhereInput = {
    versions: { some: { status: { in: ["APPROVED", "PENDING_REVIEW"] }, scanVerdict: { not: "DANGEROUS" } } },
    ...(q ? { OR: [{ name: icontains(q) }, { description: icontains(q) }] } : {}),
    ...(sp.tag ? { tags: { some: { tag: sp.tag } } } : {}),
    ...(sp.verified ? { publisher: { publisherVerified: true } } : {}),
  };
  const [total, skills, tagCounts] = await Promise.all([
    db.skill.count({ where }),
    db.skill.findMany({ where, include: { publisher: true }, orderBy: SORTS[sort], skip: (page - 1) * PAGE, take: PAGE }),
    db.skillTag.groupBy({ by: ["tag"], _count: { tag: true }, orderBy: { _count: { tag: "desc" } }, take: 20 }),
  ]);
  const tagRows = tagCounts.map((r) => ({ tag: r.tag, n: r._count.tag }));
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: q || undefined, tag: sp.tag, sort, verified: sp.verified, ...o })) if (v) p.set(k, v);
    return `/skills?${p}`;
  };

  return (
    <div className="container-x py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Skill Hub</h1>
          <p className="mt-2 max-w-2xl text-muted">{t("lead")}</p>
        </div>
        <Link href="/skills/new" className="btn-primary">{t("submit")}</Link>
      </div>

      <form className="mt-8 flex flex-wrap gap-3" action="">
        <input name="q" defaultValue={q} placeholder={t("search")} className="input max-w-md flex-1" />
        <select name="sort" defaultValue={sort} className="input w-auto">
          <option value="popular">{t("sortPopular")}</option>
          <option value="rating">{t("sortRating")}</option>
          <option value="new">{t("sortNew")}</option>
        </select>
        <Toggle name="verified" defaultChecked={!!sp.verified} label={t("verifiedOnly")} className="self-center" />
        {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
        <button className="btn-ghost">{t("searchBtn")}</button>
      </form>

      {tagRows.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {sp.tag && (
            <Link href={qs({ tag: undefined, page: undefined })} className="chip border-accent text-accent">
              ✕ {sp.tag}
            </Link>
          )}
          {tagRows
            .filter((r) => r.tag !== sp.tag)
            .map((r) => (
              <Link key={r.tag} href={qs({ tag: r.tag, page: undefined })} className="chip hover:border-accent hover:text-accent">
                #{r.tag} <span className="opacity-60">{Number(r.n)}</span>
              </Link>
            ))}
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((s) => (
          <SkillCard key={s.id} skill={s} />
        ))}
      </div>
      {skills.length === 0 && (
        <div className="card mt-8 p-10 text-center text-muted">
          {t("empty")} <Link href="/skills/new" className="text-accent underline">{t("submit")}</Link>
        </div>
      )}
      {total > PAGE && (
        <div className="mt-8 flex justify-center gap-2">
          {page > 1 && <Link className="btn-ghost" href={qs({ page: String(page - 1) })}>←</Link>}
          <span className="btn text-muted">
            {page} / {Math.ceil(total / PAGE)}
          </span>
          {page * PAGE < total && <Link className="btn-ghost" href={qs({ page: String(page + 1) })}>→</Link>}
        </div>
      )}

      <div className="card mt-12 grid gap-6 p-6 md:grid-cols-2">
        <div>
          <h2 className="h3">{t("cliTitle")}</h2>
          <p className="mt-2 text-sm text-muted">{t("cliBody")}</p>
        </div>
        <pre className="codeblock">{`sinobee skills search pdf
sinobee skills install hub:cafeca/web-research
sinobee skills publish my-skill`}</pre>
      </div>
    </div>
  );
}
