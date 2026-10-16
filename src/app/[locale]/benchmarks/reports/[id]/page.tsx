import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { modelById } from "@/lib/pricing";
import { Markdown } from "@/components/markdown";
import { LocalDate } from "@/components/date";
import { Comments } from "@/components/comments";
import { scoreColor } from "@/components/report-row";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ locale: string; id: string }> };
type Result = { score: number; verdict?: string | null; summary?: string; metrics?: Record<string, number>; cases?: { name: string; passed?: boolean; score?: number; notes?: string }[] };

export async function generateMetadata({ params }: P) {
  const r = await db.evaluationReport.findUnique({ where: { id: (await params).id }, include: { task: true } });
  return r ? { title: r.task.title } : {};
}

export default async function ReportPage({ params }: P) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("report");
  const r = await db.evaluationReport.findUnique({
    where: { id },
    include: { task: true, requester: true, skillVersion: { include: { skill: { include: { publisher: true } } } } },
  });
  if (!r) notFound();
  const res = r.result as unknown as Result;
  const who = r.requester.publisher ?? (r.requester.handle ? `@${r.requester.handle}` : r.requester.account);
  const facts: [string, React.ReactNode][] = [
    [t("time"), <LocalDate key="t" value={r.evaluatedAt} />],
    [t("requester"), <span key="r" className="font-mono text-xs break-all">{who}</span>],
    [
      t("skill"),
      r.skillVersion ? (
        <Link key="s" className="font-mono text-accent" href={`/skills/${r.skillVersion.skill.publisher.publisher}/${r.skillVersion.skill.name}?v=${r.skillVersion.version}`}>
          {r.skillVersion.skill.publisher.publisher}/{r.skillVersion.skill.name}@{r.skillVersion.version}
        </Link>
      ) : (
        <span key="s" className="text-muted">{t("noSkill")}</span>
      ),
    ],
    [t("model"), modelById(r.model)?.label ?? r.model],
    [t("method"), r.method],
  ];
  return (
    <div className="container-x py-10">
      <nav className="text-sm text-muted">
        <Link href="/benchmarks" className="hover:text-accent">{t("back")}</Link>
      </nav>
      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          <header>
            <div className="text-sm font-semibold uppercase tracking-wide text-accent">{t("label")}</div>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{r.task.title}</h1>
            {res.verdict && <p className="mt-2 text-lg text-muted">{res.verdict}</p>}
          </header>

          <section className="card p-6">
            <h2 className="h3">{t("methodTitle")}</h2>
            <p className="mt-2 text-sm"><b>{r.method}</b></p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{r.task.prompt}</p>
            {r.methodDetail && <pre className="codeblock mt-3 whitespace-pre-wrap">{r.methodDetail}</pre>}
          </section>

          <section className="card p-6">
            <h2 className="h3 mb-3">{t("process")}</h2>
            <Markdown>{r.process}</Markdown>
          </section>

          <section className="card p-6">
            <h2 className="h3 mb-3">{t("result")}</h2>
            {res.metrics && Object.keys(res.metrics).length > 0 && (
              <div className="mb-5 grid gap-3 sm:grid-cols-3">
                {Object.entries(res.metrics).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-panel-2 p-3">
                    <div className="text-xs text-muted">{k}</div>
                    <div className="mt-1 font-mono text-xl font-bold">{typeof v === "number" ? v.toFixed(1) : String(v)}</div>
                  </div>
                ))}
              </div>
            )}
            {res.cases && res.cases.length > 0 && (
              <div className="mb-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="p-2">{t("case")}</th>
                      <th className="p-2">{t("passed")}</th>
                      <th className="p-2">{t("score")}</th>
                      <th className="p-2">{t("notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.cases.map((c, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="p-2">{c.name}</td>
                        <td className="p-2">{c.passed ? "✅" : "❌"}</td>
                        <td className="p-2 font-mono">{c.score ?? "—"}</td>
                        <td className="p-2 text-muted">{c.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {res.summary && <Markdown>{res.summary}</Markdown>}
          </section>

          <Comments targetType="EVALUATION" targetId={r.id} />
        </div>
        <aside className="space-y-4">
          <div className="card p-6 text-center">
            <div className="text-sm text-muted">{t("score")}</div>
            <div className={`mt-1 text-6xl font-extrabold ${scoreColor(r.score ?? 0)}`}>{r.score?.toFixed(0) ?? "—"}</div>
            <div className="text-xs text-muted">/ 100</div>
          </div>
          <dl className="card divide-y divide-line text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1 p-4">
                <dt className="text-xs text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <Link href={`/tasks/${r.taskId}`} className="btn-ghost w-full">{t("viewTask")}</Link>
        </aside>
      </div>
    </div>
  );
}
