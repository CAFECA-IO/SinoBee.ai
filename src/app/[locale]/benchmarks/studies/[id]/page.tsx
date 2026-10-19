import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { modelLabels } from "@/lib/models";
import { Markdown } from "@/components/markdown";
import { LocalDate } from "@/components/date";
import { scoreColor } from "@/components/report-row";
import { runStats, type StudyRun } from "@/lib/evaluations";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: P) {
  const s = await db.evaluationStudy.findUnique({ where: { id: (await params).id } });
  return s && !s.hidden ? { title: s.title, description: s.summary.slice(0, 200) } : {};
}

const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
function fmtDur(s: number) {
  s = Math.round(s);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export default async function StudyPage({ params }: P) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("study");
  const labels = await modelLabels();
  const s = await db.evaluationStudy.findUnique({ where: { id }, include: { publisher: true } });
  if (!s || s.hidden) notFound();
  const runs = (s.runs as unknown as StudyRun[]).map((r) => ({ ...r, stats: runStats(r) })).sort((a, b) => b.stats.score - a.stats.score || a.stats.durationS - b.stats.durationS);
  const label = (m: string) => labels[m] ?? labels[m.replace(/^[^/]+\//, "")] ?? m;
  const who = s.publisher.publisher ?? (s.publisher.handle ? `@${s.publisher.handle}` : s.publisher.account);
  const judgeTokens = runs.reduce((a, r) => a + (r.judge_usage?.input_tokens ?? 0) + (r.judge_usage?.output_tokens ?? 0), 0);
  const tasks = runs[0]?.tasks ?? [];
  const facts: [string, React.ReactNode][] = [
    [t("kind"), s.kind === "skill" ? t("kindSkill") : t("kindModel")],
    ...(s.kind === "skill" ? ([[t("skill"), <span key="sk" className="font-mono">{s.skill}</span>]] as [string, React.ReactNode][]) : []),
    ...(s.domain ? ([[t("domain"), s.domain]] as [string, React.ReactNode][]) : []),
    [t("models"), runs.map((r) => label(r.model)).join("、")],
    [t("judge"), s.judgeModel ? <span key="j">{label(s.judgeModel)}<span className="block text-xs text-muted">{t("judgeTokens", { n: fmtTok(judgeTokens) })}</span></span> : t("noJudge")],
    [t("testedAt"), <span key="ta"><LocalDate value={s.testedAt} />{s.testedUntil && <> – <LocalDate value={s.testedUntil} /></>}</span>],
    [t("tasks"), t("tasksN", { tasks: tasks.length, trials: runs[0]?.stats.trials ?? 0 })],
    [t("client"), `SinoBee ${s.clientVersion ?? ""}`],
    [t("publisher"), <span key="p" className="font-mono text-xs break-all">{who}</span>],
  ];

  return (
    <div className="container-x py-10">
      <nav className="text-sm text-muted">
        <Link href="/benchmarks" className="hover:text-accent">{t("back")}</Link>
      </nav>
      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          <header>
            <div className="text-sm font-semibold uppercase tracking-wide text-accent">{s.kind === "skill" ? t("labelSkill") : t("labelModel")}</div>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{s.title}</h1>
            {s.summary && <p className="mt-2 text-lg text-muted">{s.summary}</p>}
          </header>

          <section className="card overflow-x-auto p-0">
            <h2 className="h3 p-6 pb-2">{t("ranking")}</h2>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">{t("model")}</th>
                  <th className="p-3">{t("score")}</th>
                  <th className="p-3">{t("passed")}</th>
                  <th className="p-3">{t("time")}</th>
                  <th className="p-3">{t("tokens")}</th>
                  <th className="p-3">{t("steps")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={r.model} className="border-t border-line">
                    <td className="p-3 text-muted">{i + 1}</td>
                    <td className="p-3 font-medium">{label(r.model)}{label(r.model) !== r.model && <div className="font-mono text-xs text-muted">{r.model}</div>}</td>
                    <td className={`p-3 text-lg font-extrabold ${scoreColor(r.stats.score)}`}>{r.stats.score.toFixed(1)}</td>
                    <td className="p-3">{r.stats.trialPass}/{r.stats.trials}<div className="text-xs text-muted">pass@k {r.stats.passAtK}/{r.stats.tasks} · pass^k {r.stats.passHatK}/{r.stats.tasks}</div></td>
                    <td className="p-3 font-mono">{fmtDur(r.stats.durationS)}<div className="text-xs text-muted">{t("perTrial", { d: fmtDur(r.stats.avgDurationS) })}</div></td>
                    <td className="p-3 font-mono">{fmtTok(r.stats.inputTokens + r.stats.outputTokens)}<div className="text-xs text-muted">{t("inOut", { i: fmtTok(r.stats.inputTokens), o: fmtTok(r.stats.outputTokens) })}</div></td>
                    <td className="p-3 font-mono">{r.stats.steps.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-6 pb-5 pt-2 text-xs text-muted">{t("scoreNote")}</p>
          </section>

          {tasks.map((task) => (
            <section key={task.id} className="card p-6">
              <h2 className="h3">{task.title}</h2>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-muted">{t("prompt")}</summary>
                <p className="mt-2 whitespace-pre-wrap text-muted">{task.prompt}</p>
              </details>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="p-2">{t("grader")}</th>
                      {runs.map((r) => (
                        <th key={r.model} className="p-2">{label(r.model)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {task.graders.map((g, gi) => (
                      <tr key={g} className="border-t border-line align-top">
                        <td className="p-2">{g}</td>
                        {runs.map((r) => {
                          const rt = r.tasks.find((x) => x.id === task.id);
                          const marks = (rt?.trials ?? []).map((tr) => tr.grades[gi]);
                          return (
                            <td key={r.model} className="p-2">
                              {marks.map((m, k) => (
                                <span key={k} title={m?.detail} className={m?.ok ? "text-ok" : "text-err"}>{m ? (m.ok ? "✓" : "✕") : "—"} </span>
                              ))}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="border-t border-line text-muted">
                      <td className="p-2">{t("trialCost")}</td>
                      {runs.map((r) => {
                        const tr = r.tasks.find((x) => x.id === task.id)?.trials ?? [];
                        return (
                          <td key={r.model} className="p-2 font-mono text-xs">
                            {tr.map((x, k) => (
                              <div key={k}>{fmtDur(x.duration_s ?? 0)} · {fmtTok((x.input_tokens ?? 0) + (x.output_tokens ?? 0))} tok · {x.status}{x.error ? ` · ${x.error.slice(0, 60)}` : ""}</div>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {s.body && (
            <section className="card p-6">
              <h2 className="h3 mb-3">{t("analysis")}</h2>
              <Markdown>{s.body}</Markdown>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <div className="card divide-y divide-line text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="p-4">
                <div className="text-xs text-muted">{k}</div>
                <div className="mt-1">{v}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">{t("howNote")}</p>
        </aside>
      </div>
    </div>
  );
}
