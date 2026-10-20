import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db, icontains } from "@/lib/db";
import { SkillCard } from "@/components/skill-card";
import { skillMarks } from "@/components/skill-tag";
import { OFFICIAL, OFFICIAL_PUBLISHER, isOfficialSkill, skillTag, type OfficialName } from "@/lib/skills/official";
import { CopyButton } from "@/components/copy-button";
import { Icon, type IconName } from "@/components/icon";
import type { Prisma } from "@/generated/prisma/client";
import { securityStatus } from "@/lib/bench-suites";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "skills" });
  return { title: "Skill Hub", description: t("lead") };
}

const PAGE = 24;
const FEATURED: { name: OfficialName; icon: IconName }[] = [
  { name: "ai-video-production", icon: "video" },
  { name: "memory-management", icon: "brain" },
  { name: "database-analysis", icon: "database" },
];
const HOW: { k: string; icon: IconName }[] = [
  { k: "format", icon: "folder" },
  { k: "trust", icon: "shield" },
  { k: "suggest", icon: "sparkles" },
  { k: "workflow", icon: "flow" },
];
const SORTS: Record<string, Prisma.SkillOrderByWithRelationInput[]> = {
  popular: [{ downloads: "desc" }],
  rating: [{ ratingAvg: "desc" }, { ratingCount: "desc" }],
  new: [{ createdAt: "desc" }],
};
const SORT_ICON: Record<string, IconName> = { popular: "download", rating: "sparkles", new: "plus" };
const LISTED: Prisma.SkillWhereInput = {
  versions: { some: { status: { in: ["APPROVED", "PENDING_REVIEW"] }, scanVerdict: { not: "DANGEROUS" } } },
};

type SP = { q?: string; tag?: string; sort?: string; page?: string; verified?: string; official?: string; kind?: string };

export default async function SkillsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("skills");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const sort = sp.sort && sp.sort in SORTS ? sp.sort : "popular";
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.SkillWhereInput = {
    ...LISTED,
    ...(q ? { OR: [{ name: icontains(q) }, { description: icontains(q) }] } : {}),
    ...(sp.tag ? { tags: { some: { tag: sp.tag } } } : {}),
    ...(sp.kind === "evaluation" ? { kind: "evaluation" } : {}),
    ...(sp.official ? { name: { in: [...OFFICIAL] } } : {}),
    ...(sp.verified || sp.official
      ? { publisher: { ...(sp.verified ? { publisherVerified: true } : {}), ...(sp.official ? { publisher: OFFICIAL_PUBLISHER } : {}) } }
      : {}),
  };
  const [total, skills, tagCounts, all, publishers] = await Promise.all([
    db.skill.count({ where }),
    db.skill.findMany({ where, include: { publisher: true, versions: { where: { status: { in: ["APPROVED", "PENDING_REVIEW"] }, scanVerdict: { not: "DANGEROUS" } }, orderBy: { publishedAt: "desc" }, take: 1, select: { anchorCode: true, status: true, signature: true, securityReport: true } } }, orderBy: SORTS[sort], skip: (page - 1) * PAGE, take: PAGE }),
    db.skillTag.groupBy({ by: ["tag"], _count: { tag: true }, orderBy: { _count: { tag: "desc" } }, take: 18 }),
    db.skill.aggregate({ where: LISTED, _count: { _all: true }, _sum: { downloads: true } }),
    db.skill.groupBy({ by: ["publisherId"], where: LISTED }),
  ]);
  const tagRows = tagCounts.map((r) => ({ tag: r.tag, n: r._count.tag }));
  // evaluation skills: what they are for, their 4 security checks, the suites and reports written with them
  const evNames = skills.filter((s) => s.kind === "evaluation").map((s) => s.name);
  const [evSuites, evReports] = evNames.length
    ? await Promise.all([
        db.benchSuite.groupBy({ by: ["evaluator"], where: { evaluator: { in: evNames }, hidden: false }, _count: { _all: true }, _sum: { reportCount: true } }),
        db.benchEval.findMany({ where: { hidden: false, visibility: "public", OR: evNames.map((n) => ({ evaluator: { startsWith: `${n}@` } })) }, select: { evaluator: true, data: true }, take: 2000 }),
      ])
    : [[], []];
  const evStats = (name: string) => {
    const g = evSuites.find((x) => x.evaluator === name);
    const agree = evReports.filter((r) => r.evaluator?.startsWith(`${name}@`)).map((r) => (r.data as { judge2Agree?: [number, number] | null }).judge2Agree).filter((a): a is [number, number] => !!a && a[1] > 0);
    const a = agree.reduce((x, y) => [x[0] + y[0], x[1] + y[1]], [0, 0]);
    return { suites: g?._count._all ?? 0, reports: g?._sum.reportCount ?? 0, agree: a[1] ? a[0] / a[1] : null };
  };
  const evExtra = (s: (typeof skills)[number]) => {
    if (s.kind !== "evaluation") return undefined;
    const v = s.versions[0];
    const sec = securityStatus(v?.securityReport, v?.status === "APPROVED");
    const st = evStats(s.name);
    return (
      <div className="mt-3 space-y-1 text-xs">
        <div className="text-muted">{t("evTargets")}{s.targets === "*" || !s.targets ? t("evAll") : s.targets}</div>
        <div className="flex flex-wrap gap-1">
          <span className={`chip ${sec.passed === 4 ? "border-accent text-ok" : sec.blocked ? "text-err" : "text-warn"}`}>{t("evSecurity", { n: sec.passed })}</span>
          <span className="chip">{t("evSuites", { n: st.suites })}</span>
          <span className="chip">{t("evReports", { n: st.reports })}</span>
          {st.agree !== null && <span className="chip">{t("evAgree", { p: Math.round(st.agree * 100) })}</span>}
        </div>
      </div>
    );
  };
  const qs = (o: Partial<SP>) => {
    const p = new URLSearchParams();
    const cur: SP = { q: q || undefined, tag: sp.tag, sort: sort === "popular" ? undefined : sort, verified: sp.verified, official: sp.official, kind: sp.kind };
    for (const [k, v] of Object.entries({ ...cur, ...o })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/skills?${s}` : "/skills";
  };
  const isOfficial = (s: (typeof skills)[number]) => isOfficialSkill(s.publisher.publisher, s.name);
  const filtered = !!(q || sp.tag || sp.verified || sp.official || sp.kind);
  const pages = Math.ceil(total / PAGE);
  const stats: [number, string][] = [
    [all._count._all, t("statSkills")],
    [publishers.length, t("statPublishers")],
    [all._sum.downloads ?? 0, t("statDownloads")],
  ];
  const side = "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition hover:bg-panel-2";

  return (
    <>
      {/* hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:radial-gradient(var(--accent)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="container-x relative py-12">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 max-w-2xl">
              <span className="chip border-accent/40 text-accent">{t("standardBadge")}</span>
              <h1 className="h1 mt-4">Skill Hub</h1>
              <p className="mt-3 text-muted">{t("lead")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/docs/hub-api" aria-label={t("apiDocs")} data-tip={t("apiDocs")} className="icon-btn outline lg"><Icon name="list" /></Link>
              <a href="#cli" aria-label={t("cliTitle")} data-tip={t("cliTitle")} className="icon-btn outline lg"><Icon name="terminal" /></a>
              <Link href="/skills/new" aria-label={t("submit")} data-tip={t("submit")} className="icon-btn solid lg tip-end"><Icon name="plus" /></Link>
            </div>
          </div>
          <form action="" className="mt-8 flex max-w-2xl items-center gap-2 rounded-2xl border border-line bg-panel p-1.5 shadow-sm focus-within:border-accent">
            <span className="pl-2 text-muted"><Icon name="search" /></span>
            <input name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted" />
            {sort !== "popular" && <input type="hidden" name="sort" value={sort} />}
            {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
            {sp.verified && <input type="hidden" name="verified" value="1" />}
            {sp.official && <input type="hidden" name="official" value="1" />}
            <button aria-label={t("searchBtn")} data-tip={t("searchBtn")} className="icon-btn solid"><Icon name="search" /></button>
          </form>
          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
            {stats.map(([n, l]) => (
              <div key={l} className="flex items-baseline gap-2">
                <dt className="text-2xl font-extrabold text-accent">{Number(n).toLocaleString()}</dt>
                <dd className="text-sm text-muted">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="container-x py-10">
        {/* featured official skills (default view only) */}
        {!filtered && page === 1 && (
          <section>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="h2">{t("featuredTitle")}</h2>
                <p className="mt-1 text-sm text-muted">{t("officialLead")}</p>
              </div>
              <Link href={qs({ official: "1", page: undefined })} className="text-sm font-semibold text-accent">{t("allOfficial")} →</Link>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {FEATURED.map(({ name, icon }) => (
                <div key={name} className="card relative flex flex-col overflow-hidden p-5">
                  <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#2fb3a0] to-[#7fe8b6]" />
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-[#2fb3a0] to-[#7fe8b6] text-[#04201a]">
                      <Icon name={icon} className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <Link href={`/skills/${OFFICIAL_PUBLISHER}/${name}`} className="block truncate font-semibold hover:text-accent">{t(`official.${name}.title`)}</Link>
                      <div className="truncate font-mono text-xs text-muted">{OFFICIAL_PUBLISHER}/{name}</div>
                    </div>
                  </div>
                  <p className="mt-3 flex-1 text-sm text-muted">{t(`official.${name}.body`)}</p>
                  <div className="mt-4 flex items-center gap-1 rounded-xl border border-line bg-code py-1 pl-3 pr-1">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">sinobee skills install hub:{OFFICIAL_PUBLISHER}/{name}</code>
                    <CopyButton text={`sinobee skills install hub:${OFFICIAL_PUBLISHER}/${name}`} label={t("copy")} done={t("copied")} className="tip-end" />
                    <Link href={`/skills/${OFFICIAL_PUBLISHER}/${name}`} aria-label={t("details")} data-tip={t("details")} className="icon-btn !h-8 !w-8 tip-end"><Icon name="external" className="h-4 w-4" /></Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* browse: filters + results */}
        <section className={`grid grid-cols-1 gap-8 lg:grid-cols-[230px_minmax(0,1fr)] ${!filtered && page === 1 ? "mt-14" : ""}`}>
          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("filterSort")}</div>
              <div className="flex flex-wrap gap-1 lg:flex-col">
                {(["popular", "rating", "new"] as const).map((k) => (
                  <Link key={k} href={qs({ sort: k === "popular" ? undefined : k, page: undefined })}
                    className={`${side} ${sort === k ? "bg-accent-soft font-semibold text-accent" : "text-ink/80"}`}>
                    <Icon name={SORT_ICON[k]} className="h-4 w-4" />
                    {t(`sort${k[0].toUpperCase()}${k.slice(1)}` as "sortPopular")}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("filterKind")}</div>
              <div className="flex flex-wrap gap-1 lg:flex-col">
                {([undefined, "evaluation"] as const).map((k) => (
                  <Link key={k ?? "all"} href={qs({ kind: k, page: undefined })} aria-pressed={sp.kind === k}
                    className={`${side} ${(sp.kind ?? undefined) === k ? "bg-accent-soft font-semibold text-accent" : "text-ink/80"}`}>
                    <Icon name={k ? "shield" : "folder"} className="h-4 w-4" /> {k ? t("kindEvaluation") : t("kindAll")}
                  </Link>
                ))}
              </div>
              {sp.kind === "evaluation" && <p className="mt-2 text-xs text-muted">{t("kindEvaluationNote")}</p>}
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("filterOnly")}</div>
              <div className="flex flex-wrap gap-1 lg:flex-col">
                <Link href={qs({ official: sp.official ? undefined : "1", page: undefined })} aria-pressed={!!sp.official}
                  className={`${side} ${sp.official ? "bg-accent-soft font-semibold text-accent" : "text-ink/80"}`}>
                  <Icon name="badge" className="h-4 w-4" /> {t("officialTitle")}
                </Link>
                <Link href={qs({ verified: sp.verified ? undefined : "1", page: undefined })} aria-pressed={!!sp.verified}
                  className={`${side} ${sp.verified ? "bg-accent-soft font-semibold text-accent" : "text-ink/80"}`}>
                  <Icon name="shield" className="h-4 w-4" /> {t("verifiedOnly")}
                </Link>
              </div>
            </div>
            {tagRows.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("filterTags")}</div>
                <div className="flex flex-wrap gap-1.5 max-lg:[&>a:nth-child(n+11)]:hidden">
                  {tagRows.map((r) => (
                    <Link key={r.tag} href={qs({ tag: r.tag === sp.tag ? undefined : r.tag, page: undefined })}
                      className={`chip transition ${r.tag === sp.tag ? "border-accent bg-accent-soft text-accent" : "hover:border-accent hover:text-accent"}`}>
                      #{r.tag} <span className="opacity-60">{r.n}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </aside>

          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="h3 mr-2">{t("browseTitle")}</h2>
              <span className="text-sm text-muted">{t("count", { n: total })}</span>
              {q && <Link href={qs({ q: undefined, page: undefined })} className="chip border-accent text-accent">“{q}” ✕</Link>}
              {sp.tag && <Link href={qs({ tag: undefined, page: undefined })} className="chip border-accent text-accent">#{sp.tag} ✕</Link>}
              {filtered && <Link href="/skills" className="ml-auto text-sm text-muted hover:text-accent">{t("clear")}</Link>}
            </div>
            {skills.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {skills.map((s) => (
                  <SkillCard key={s.id} skill={s} official={isOfficial(s)} marks={skillMarks(skillTag(s, s.versions[0]), s.versions[0], (k) => t(`mark.${k}`))}
                    title={isOfficial(s) ? t(`official.${s.name}.title`) : undefined} extra={evExtra(s)} />
                ))}
              </div>
            ) : (
              <div className="card flex flex-col items-center gap-3 p-10 text-center text-muted">
                <Icon name="search" className="h-8 w-8" />
                {t("empty")}
                <Link href="/skills/new" className="btn-primary"><Icon name="plus" className="h-4 w-4" />{t("submit")}</Link>
              </div>
            )}
            {pages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-2">
                {page > 1 && <Link className="icon-btn outline" aria-label={t("prev")} data-tip={t("prev")} href={qs({ page: String(page - 1) })}>←</Link>}
                <span className="px-2 text-sm text-muted">{page} / {pages}</span>
                {page < pages && <Link className="icon-btn outline" aria-label={t("next")} data-tip={t("next")} href={qs({ page: String(page + 1) })}>→</Link>}
              </div>
            )}
          </div>
        </section>

        {/* how skills work */}
        <section className="mt-16">
          <h2 className="h2">{t("howTitle")}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW.map(({ k, icon }) => (
              <div key={k} className="card p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon name={icon} /></div>
                <div className="mt-3 font-semibold">{t(`how.${k}.title`)}</div>
                <p className="mt-1.5 text-sm text-muted">{t(`how.${k}.body`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CLI */}
        <section id="cli" className="card mt-8 grid scroll-mt-24 gap-6 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon name="terminal" /></div>
            <h2 className="h3 mt-3">{t("cliTitle")}</h2>
            <p className="mt-2 text-sm text-muted">{t("cliBody")}</p>
          </div>
          <pre className="codeblock whitespace-pre-wrap break-all">{`sinobee skills search video
sinobee skills install hub:cafeca/ai-video-production
sinobee skills outdated && sinobee skills update
sinobee skills validate ./my-skill
sinobee skills export my-skill   # .tar.gz with scripts & references
sinobee skills publish my-skill`}</pre>
        </section>
      </div>
    </>
  );
}
