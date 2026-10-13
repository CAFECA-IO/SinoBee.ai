import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { parseSkillMd, compareVersions } from "@/lib/skills/spec";
import { bundleUrl } from "@/lib/skills/service";
import { Markdown } from "@/components/markdown";
import { Stars } from "@/components/stars";
import { RateSkill } from "@/components/rate-skill";
import { Comments } from "@/components/comments";
import { CopyCode } from "@/components/copy-code";
import { StatusBadge } from "@/components/status-badge";
import { LocalDate } from "@/components/date";
import { ReportRow } from "@/components/report-row";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ locale: string; publisher: string; name: string }>; searchParams: Promise<{ v?: string }> };

async function load(publisher: string, name: string) {
  return db.skill.findFirst({
    where: { name, publisher: { publisher } },
    include: { publisher: true, tags: true, versions: { orderBy: { publishedAt: "desc" } } },
  });
}

export async function generateMetadata({ params }: P) {
  const { publisher, name } = await params;
  const s = await load(publisher, name);
  return s ? { title: `${s.name} — ${publisher}`, description: s.description } : {};
}

export default async function SkillPage({ params, searchParams }: P) {
  const { locale, publisher, name } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("skill");
  const skill = await load(publisher, name);
  if (!skill) notFound();
  const me = await currentUser();
  const isOwner = me?.id === skill.publisherId;
  const visible = skill.versions
    .filter((v) => isOwner || me?.isAdmin || (["APPROVED", "PENDING_REVIEW"].includes(v.status) && v.scanVerdict !== "DANGEROUS"))
    .sort((a, b) => compareVersions(b.version, a.version));
  if (!visible.length) notFound();
  const { v: wanted } = await searchParams;
  const ver = visible.find((v) => v.version === wanted) ?? visible.find((v) => v.status === "APPROVED") ?? visible[0];
  const { frontmatter, body } = (() => {
    try {
      return parseSkillMd(ver.skillMd);
    } catch {
      return { frontmatter: {} as Record<string, unknown>, body: ver.skillMd };
    }
  })();
  const meta = ((frontmatter as { metadata?: Record<string, string> }).metadata ?? {}) as Record<string, string>;
  const trustVerified = skill.publisher.publisherVerified && ver.status === "APPROVED" && !!ver.signature;
  const [myRating, reports] = await Promise.all([
    me ? db.skillRating.findUnique({ where: { skillId_userId: { skillId: skill.id, userId: me.id } } }) : null,
    db.evaluationReport.findMany({
      where: { skillVersion: { skillId: skill.id } },
      include: { requester: true, skillVersion: { include: { skill: { include: { publisher: true } } } } },
      orderBy: { evaluatedAt: "desc" },
      take: 20,
    }),
  ]);
  const files = Object.entries(ver.files as Record<string, number>);

  return (
    <div className="container-x py-10">
      <nav className="text-sm text-muted">
        <Link href="/skills" className="hover:text-accent">Skill Hub</Link> / {publisher} / <span className="text-ink">{name}</span>
      </nav>
      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-8">
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-3xl font-bold">{skill.name}</h1>
              <span className={`badge ${trustVerified ? "bg-accent-soft text-ok" : "bg-panel-2 text-muted"}`}>{trustVerified ? t("trustVerified") : t("trustCommunity")}</span>
              <StatusBadge status={ver.status} />
            </div>
            <p className="mt-3 text-lg text-muted">{skill.description}</p>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted">
              <span>
                {t("by")} <b className="text-ink">{publisher}</b> {skill.publisher.publisherVerified && <span className="text-accent">✔</span>}
              </span>
              <Stars value={skill.ratingAvg} count={skill.ratingCount} />
              <span>↓ {skill.downloads.toLocaleString()}</span>
              {skill.license && <span>{skill.license}</span>}
            </div>
            {skill.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {skill.tags.map(({ tag }) => (
                  <Link key={tag} href={`/skills?tag=${encodeURIComponent(tag)}`} className="chip hover:text-accent">#{tag}</Link>
                ))}
              </div>
            )}
          </header>

          {ver.scanVerdict !== "CLEAN" && (
            <div className={`rounded-xl border p-4 text-sm ${ver.scanVerdict === "DANGEROUS" ? "border-err/40 bg-err-soft text-err" : "border-warn/40 bg-warn-soft text-warn"}`}>
              <b>{t("scan")}: {ver.scanVerdict}</b>
              <ul className="mt-2 list-disc pl-5">
                {(ver.scanFindings as { file: string; rule: string; excerpt: string }[]).map((f, i) => (
                  <li key={i}>
                    <code>{f.file}</code> · {f.rule} — <span className="opacity-80">{f.excerpt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <section className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="h3">SKILL.md</h2>
              <span className="chip font-mono">v{ver.version}</span>
            </div>
            <Markdown>{body}</Markdown>
          </section>

          <section className="card overflow-hidden">
            <h2 className="h3 border-b border-line p-4">{t("versions")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="p-3">{t("version")}</th>
                    <th className="p-3">{t("status")}</th>
                    <th className="p-3">{t("published")}</th>
                    <th className="p-3">{t("contentHash")}</th>
                    <th className="p-3">{t("signature")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((v) => (
                    <tr key={v.id} className="border-t border-line">
                      <td className="p-3 font-mono">
                        <Link href={`/skills/${publisher}/${name}?v=${v.version}`} className={v.id === ver.id ? "font-bold text-accent" : "hover:text-accent"}>
                          {v.version}
                        </Link>
                      </td>
                      <td className="p-3"><StatusBadge status={v.status} /></td>
                      <td className="p-3 text-muted"><LocalDate value={v.publishedAt} withTime={false} /></td>
                      <td className="max-w-[180px] truncate p-3 font-mono text-xs text-muted" title={v.contentHash}>{v.contentHash}</td>
                      <td className="p-3 text-xs">{v.signature ? <span className="text-ok">ed25519 ✓</span> : <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="h3">{t("evaluations")}</h2>
              <Link href={`/benchmarks/new?skill=${ver.id}`} className="btn-ghost !py-2">{t("commissionEval")}</Link>
            </div>
            {reports.length === 0 ? <p className="text-sm text-muted">{t("noEvaluations")}</p> : <div className="card divide-y divide-line">{reports.map((r) => <ReportRow key={r.id} r={r} />)}</div>}
          </section>

          <Comments targetType="SKILL" targetId={skill.id} />
        </div>

        <aside className="space-y-4">
          <div className="card space-y-3 p-5">
            <div className="text-sm font-semibold">{t("install")}</div>
            <CopyCode code={`sinobee skills install hub:${publisher}/${name}@${ver.version}`} />
            <a href={bundleUrl(publisher, name, ver.version).replace(/^https?:\/\/[^/]+/, "")} className="btn-primary w-full">
              {t("download")} ({(ver.bundleSize / 1024).toFixed(1)} KB)
            </a>
            <Link href={`/tasks/new?skill=${ver.id}`} className="btn-ghost w-full">{t("useInTask")}</Link>
          </div>
          <div className="card p-5">
            <div className="text-sm font-semibold">{t("rate")}</div>
            <div className="mt-2">{me ? <RateSkill skillId={skill.id} mine={myRating?.stars ?? 0} /> : <p className="text-sm text-muted">{t("loginToRate")}</p>}</div>
          </div>
          <div className="card space-y-2 p-5 text-sm">
            <div className="font-semibold">{t("details")}</div>
            {Object.entries({ ...meta, compatibility: (frontmatter as { compatibility?: string }).compatibility, "allowed-tools": (frontmatter as Record<string, string>)["allowed-tools"] })
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-muted">{k}</span>
                  <span className="truncate text-right" title={String(v)}>{String(v)}</span>
                </div>
              ))}
          </div>
          <div className="card p-5 text-sm">
            <div className="font-semibold">{t("files")} ({files.length})</div>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {files.slice(0, 50).map(([f, size]) => (
                <li key={f} className="flex justify-between gap-2">
                  <span className="truncate">{f}</span>
                  <span className="text-muted">{size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
