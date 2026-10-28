import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { withDbFallback } from "@/lib/db-health";
import { agentAccess } from "@/lib/agent-access";
import { SkillCard } from "@/components/skill-card";
import { isOfficialSkill, skillTag } from "@/lib/skills/official";
import { skillMarks } from "@/components/skill-tag";
import { CopyCode } from "@/components/copy-code";
import { Icon } from "@/components/icon";
import { HeroHive } from "@/components/hero-hive";
import { HighlightArt, type HighlightKey } from "@/components/highlight-art";
import { BlackBox, type BlackBoxText } from "@/components/black-box";

export const dynamic = "force-dynamic";

/** six working modes, each with an example request */
const FEATURES = ["research", "track", "device", "learn", "build", "video"] as const;
const ICONS: Record<(typeof FEATURES)[number], string> = {
  research: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
  track: "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19h.01",
  device: "M3 5h18v11H3zM8 21h8M12 16v5",
  learn: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  build: "M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 5l-3 14",
  video: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
};

/** what sets SinoBee apart: four cards, each with a honeycomb picture of its mechanism */
const HIGHLIGHTS: HighlightKey[] = ["large", "roles", "memory", "safety"];
const ART_LABELS = ["m1", "parallel", "merge", "plan", "think", "do", "check", "permanent", "long", "short", "task"] as const;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tSkills = await getTranslations("skills");
  // the landing page still renders without the database: no stats, no popular skills
  const { value: data } = await withDbFallback(() => Promise.all([
    db.skill.findMany({
      where: { versions: { some: { status: { in: ["APPROVED", "PENDING_REVIEW"] }, scanVerdict: { not: "DANGEROUS" } } } },
      include: { publisher: true, versions: { where: { status: { in: ["APPROVED", "PENDING_REVIEW"] }, scanVerdict: { not: "DANGEROUS" } }, orderBy: { publishedAt: "desc" }, take: 1, select: { anchorCode: true, status: true, signature: true } } },
      orderBy: [{ downloads: "desc" }, { ratingAvg: "desc" }],
      take: 6,
    }),
    Promise.all([db.skill.count({ where: { versions: { some: { status: { in: ["APPROVED", "PENDING_REVIEW"] }, scanVerdict: { not: "DANGEROUS" } } } } }), db.task.count({ where: { status: "COMPLETED" } }), db.evaluationReport.count({ where: { task: { status: "COMPLETED" } } })]),
  ]), null);
  const skills = data?.[0] ?? [];
  const access = await agentAccess();
  const stats = data?.[1] ?? null;

  return (
    <>
      {/* hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:radial-gradient(var(--accent)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="container-x relative grid grid-cols-1 items-center gap-10 py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:py-24">
          <div className="min-w-0">
            <span className="chip border-accent/40 text-accent">{t("badge")}</span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              {t("title1")}
              <br />
              <span className="bg-gradient-to-r from-[#2fb3a0] to-[#7fe8b6] bg-clip-text text-transparent">{t("title2")}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">{t("lead")}</p>
            {/* 線上使用 is an admin switch (off by default): visitors then get the download first and a Coming soon tag */}
            <div className="mt-8 flex flex-wrap gap-3">
              {access.allowed ? (
                <>
                  <Link href="/agent" target="_blank" className="btn-primary !px-6 !py-3 text-base">
                    <Icon name="rocket" />
                    {t("ctaTry")}
                    {access.admin && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn">{t("adminPreview")}</span>}
                  </Link>
                  <Link href="/download" aria-label={t("ctaInstall")} data-tip={t("ctaInstall")} className="icon-btn outline lg"><Icon name="download" /></Link>
                </>
              ) : (
                <>
                  <Link href="/download" className="btn-primary !px-6 !py-3 text-base"><Icon name="download" />{t("ctaInstall")}</Link>
                  <button type="button" disabled aria-disabled="true" className="btn !cursor-not-allowed border border-dashed border-line bg-panel !px-4 !py-3 text-base text-muted !opacity-100">
                    {t("ctaTry")}
                    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn">Coming soon</span>
                  </button>
                </>
              )}
              <Link href="/crowd/new" aria-label={t("ctaCommission")} data-tip={t("ctaCommission")} className="icon-btn outline lg"><Icon name="users" /></Link>
            </div>
            <p className={`mt-3 text-sm ${access.admin ? "text-warn" : "text-muted"}`}>{access.online ? t("tryNote") : access.admin ? t("tryNoteAdmin") : t("tryNoteSoon")}</p>
            <div className="mt-8 max-w-xl">
              <CopyCode code={"git clone https://github.com/CAFECA-IO/SinoBee.git && cd SinoBee\ndocker compose up -d --build"} />
            </div>
          </div>
          <div className="min-w-0">
            <HeroHive label={t("heroAlt")} />
          </div>
        </div>
      </section>

      {/* stats (hidden while the database is unreachable) */}
      {stats && (
      <section className="container-x grid grid-cols-3 gap-4 py-10 text-center">
        {[
          [stats[0], t("statSkills")],
          [stats[1], t("statTasks")],
          [stats[2], t("statReports")],
        ].map(([n, l]) => (
          <div key={String(l)}>
            <div className="text-3xl font-extrabold text-accent">{Number(n).toLocaleString()}</div>
            <div className="mt-1 text-sm text-muted">{l}</div>
          </div>
        ))}
      </section>
      )}

      {/* features: what it can do */}
      <section className="container-x py-12">
        <h2 className="h2">{t("featuresTitle")}</h2>
        <p className="mt-2 max-w-2xl text-muted">{t("featuresLead")}</p>
        <div className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f} className="flex min-w-0 gap-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={ICONS[f]} />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold">{t(`f.${f}.title`)}</h3>
                <p className="mt-1 text-sm text-muted">{t(`f.${f}.body`)}</p>
                <p className="mt-2 text-xs text-ink/70">{t(`f.${f}.ex`)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* what sets SinoBee apart */}
      <section className="container-x py-12">
        <span className="chip border-accent/40 text-accent">{t("hl.eyebrow")}</span>
        <h2 className="h2 mt-4 !text-3xl">
          {t("hl.title1")}
          <span className="text-accent">{t("hl.title2")}</span>
        </h2>
        <p className="mt-2 max-w-2xl text-muted">{t("hl.lead")}</p>
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {HIGHLIGHTS.map((k) => (
            <article key={k} className="card grid gap-6 p-6 sm:grid-cols-[180px_minmax(0,1fr)] sm:p-7">
              <div className="flex justify-center sm:block">
                <HighlightArt kind={k} alt={t(`hl.items.${k}.art`)} labels={Object.fromEntries(ART_LABELS.map((l) => [l, t(`hl.art.${l}`)])) as Record<(typeof ART_LABELS)[number], string>} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-accent">{t(`hl.items.${k}.label`)}</div>
                <h3 className="mt-2 text-xl font-extrabold leading-snug">{t(`hl.items.${k}.title`)}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{t(`hl.items.${k}.body`)}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {Object.keys(t.raw(`hl.items.${k}.tags`) as Record<string, string>).map((i) => (
                    <span key={i} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent">{t(`hl.items.${k}.tags.${i}`)}</span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* open the black box: how SinoBee shows its reasoning */}
      <BlackBox t={t.raw("bb") as BlackBoxText} />

      {/* three pillars of the site */}
      <section className="container-x grid gap-6 py-12 lg:grid-cols-3">
        {(["hub", "commission", "bench"] as const).map((k) => (
          <div key={k} className="card flex flex-col p-6">
            <h3 className="h3">{t(`pillars.${k}.title`)}</h3>
            <p className="mt-2 flex-1 text-sm text-muted">{t(`pillars.${k}.body`)}</p>
            <Link href={k === "hub" ? "/skills" : k === "commission" ? "/crowd" : "/benchmarks"} className="btn-ghost mt-5 self-start">
              {t(`pillars.${k}.cta`)} →
            </Link>
          </div>
        ))}
      </section>

      {/* popular skills */}
      {skills.length > 0 && (
        <section className="container-x py-12">
          <div className="flex items-end justify-between">
            <h2 className="h2">{t("popularSkills")}</h2>
            <Link href="/skills" className="text-sm font-semibold text-accent">{t("viewAll")} →</Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {skills.map((s) => (
              <SkillCard key={s.id} skill={s} official={isOfficialSkill(s.publisher.publisher, s.name)} marks={skillMarks(skillTag(s, s.versions[0]), s.versions[0], (k) => tSkills(`mark.${k}`))} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
