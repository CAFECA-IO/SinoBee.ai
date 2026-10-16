import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { SkillCard } from "@/components/skill-card";
import { isOfficialSkill, skillTag } from "@/lib/skills/official";
import { skillMarks } from "@/components/skill-tag";
import { CopyCode } from "@/components/copy-code";
import { AGENT_URL } from "@/lib/links";
import { Icon } from "@/components/icon";
import { HeroHive } from "@/components/hero-hive";

export const dynamic = "force-dynamic";

const FEATURES = ["research", "data", "files", "video", "work", "steer", "browser", "approval", "memory", "skills", "models", "usage"] as const;
const ICONS: Record<(typeof FEATURES)[number], string> = {
  research: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
  data: "M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6",
  files: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  approval: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM9 12l2 2 4-4",
  browser: "M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01",
  memory: "M12 4a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 8 0v-1a3 3 0 0 0 0-6V8a4 4 0 0 0-4-4z",
  skills: "M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.6 6.5 19.5l1-6.3L3 8.9 9 8z",
  usage: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  models: "M4 6h16M4 12h16M4 18h10",
  video: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
  work: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  steer: "M4 12h10M10 6l6 6-6 6M20 5v14",
};

const MORE_CASES = ["video", "sequel", "schedule", "team", "forms", "code"] as const;
const CASE_ICONS: Record<(typeof MORE_CASES)[number], string> = {
  video: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
  sequel: "M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h4.5V11M13 16.5H8.5V13",
  schedule: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  team: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5",
  forms: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h4",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12",
};

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tSkills = await getTranslations("skills");
  const [skills, stats] = await Promise.all([
    db.skill.findMany({
      where: { versions: { some: { status: { in: ["APPROVED", "PENDING_REVIEW"] }, scanVerdict: { not: "DANGEROUS" } } } },
      include: { publisher: true, versions: { where: { status: { in: ["APPROVED", "PENDING_REVIEW"] }, scanVerdict: { not: "DANGEROUS" } }, orderBy: { publishedAt: "desc" }, take: 1, select: { anchorCode: true, status: true, signature: true } } },
      orderBy: [{ downloads: "desc" }, { ratingAvg: "desc" }],
      take: 6,
    }),
    Promise.all([db.skill.count({ where: { versions: { some: { status: { in: ["APPROVED", "PENDING_REVIEW"] }, scanVerdict: { not: "DANGEROUS" } } } } }), db.task.count({ where: { status: "COMPLETED" } }), db.evaluationReport.count()]),
  ]);

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
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={AGENT_URL} target="_blank" rel="noopener" className="btn-primary !px-6 !py-3 text-base"><Icon name="rocket" />{t("ctaTry")}</a>
              <Link href="/download" aria-label={t("ctaInstall")} data-tip={t("ctaInstall")} className="icon-btn outline lg"><Icon name="download" /></Link>
              <Link href="/tasks/new" aria-label={t("ctaCommission")} data-tip={t("ctaCommission")} className="icon-btn outline lg"><Icon name="task" /></Link>
            </div>
            <p className="mt-3 text-sm text-muted">{t("tryNote")}</p>
            <div className="mt-8 max-w-xl">
              <CopyCode code={"git clone https://github.com/CAFECA-IO/SinoBee.git && cd SinoBee\ndocker compose up -d --build"} />
            </div>
          </div>
          <div className="min-w-0">
            <HeroHive label={t("heroAlt")} />
          </div>
        </div>
      </section>

      {/* stats */}
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

      {/* features */}
      <section className="container-x py-12">
        <h2 className="h2">{t("featuresTitle")}</h2>
        <p className="mt-2 max-w-2xl text-muted">{t("featuresLead")}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f} className="card p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={ICONS[f]} />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold">{t(`f.${f}.title`)}</h3>
              <p className="mt-1.5 text-sm text-muted">{t(`f.${f}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* use cases */}
      <section className="container-x py-12">
        <h2 className="h2">{t("casesTitle")}</h2>
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {(["usecase-research", "usecase-data-analysis", "usecase-organize-files"] as const).map((img, i) => (
            <figure key={img} className="card overflow-hidden">
              <Image src={`/screenshots/${img}.png`} alt="" width={1600} height={1075} className="h-auto w-full border-b border-line" />
              <figcaption className="p-4 text-sm">
                <div className="font-semibold">{t(`cases.${i}.title`)}</div>
                <div className="mt-1 text-muted">{t(`cases.${i}.body`)}</div>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MORE_CASES.map((k) => (
            <div key={k} className="card flex flex-col overflow-hidden">
              <Image src={`/screenshots/usecase-${k}.png`} alt={t(`more.${k}.title`)} width={1600} height={1075} className="h-auto w-full border-b border-line" />
              <div className="flex flex-1 flex-col p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={CASE_ICONS[k]} />
                  </svg>
                </div>
                <div className="font-semibold">{t(`more.${k}.title`)}</div>
              </div>
              <p className="mt-3 flex-1 text-sm text-muted">{t(`more.${k}.body`)}</p>
              <div className="mt-4 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm">
                <span className="text-muted">{t("trySay")}</span>「{t(`more.${k}.prompt`)}」
              </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t("casesNote")}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a href={AGENT_URL} target="_blank" rel="noopener" aria-label={t("ctaTry")} data-tip={t("ctaTry")} className="icon-btn solid lg"><Icon name="rocket" /></a>
          <span className="text-sm text-muted">{t("casesTry")}</span>
        </div>
      </section>

      {/* three pillars of the site */}
      <section className="container-x grid gap-6 py-12 lg:grid-cols-3">
        {(["hub", "commission", "bench"] as const).map((k) => (
          <div key={k} className="card flex flex-col p-6">
            <h3 className="h3">{t(`pillars.${k}.title`)}</h3>
            <p className="mt-2 flex-1 text-sm text-muted">{t(`pillars.${k}.body`)}</p>
            <Link href={k === "hub" ? "/skills" : k === "commission" ? "/tasks/new" : "/benchmarks"} className="btn-ghost mt-5 self-start">
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
