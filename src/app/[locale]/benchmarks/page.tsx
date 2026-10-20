import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { modelCatalog, currentModels } from "@/lib/models";
import { EVAL_METHODS } from "@/lib/tasks/service";
import { ReportRow, scoreColor } from "@/components/report-row";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "bench" });
  return { title: t("title"), description: t("lead") };
}

export default async function BenchmarksPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("bench");
  const te = await getTranslations("evals");
  const catalog = await modelCatalog();
  const labels = Object.fromEntries([...catalog.values()].map((m) => [m.modelId, m.label]));
  const offered = (await currentModels()).length;
  const [byModel, byModelMethod, skillReports, recent, evals] = await Promise.all([
    db.evaluationReport.groupBy({ by: ["model"], where: { skillVersionId: null, task: { status: "COMPLETED" } }, _avg: { score: true }, _count: true, _max: { evaluatedAt: true } }),
    db.evaluationReport.groupBy({ by: ["model", "method"], where: { skillVersionId: null, task: { status: "COMPLETED" } }, _avg: { score: true } }),
    db.evaluationReport.findMany({
      where: { skillVersionId: { not: null }, score: { not: null }, task: { status: "COMPLETED" } },
      select: { score: true, skillVersion: { select: { skill: { select: { id: true, name: true, publisher: { select: { publisher: true } } } } } } },
    }),
    db.evaluationReport.findMany({
      where: { task: { status: "COMPLETED" } },
      include: { requester: true, skillVersion: { include: { skill: { include: { publisher: true } } } } },
      orderBy: { evaluatedAt: "desc" },
      take: 20,
    }),
    db.benchEval.findMany({ where: { hidden: false, visibility: "public" }, orderBy: { testedAt: "desc" }, take: 500, select: { kind: true, subject: true, title: true, fairScore: true, trials: true } }),
  ]);
  // one card per skill / domain with SinoBee evaluations
  const subjects = [...new Map(evals.map((e) => [`${e.kind}|${e.subject}`, e])).values()].map((e) => {
    const rows = evals.filter((x) => x.kind === e.kind && x.subject === e.subject);
    return { ...e, n: rows.length, best: Math.max(...rows.filter((x) => x.trials >= 3).map((x) => x.fairScore), -1) };
  });
  // average score per skill (portable across PostgreSQL / SQLite)
  const skillAgg = new Map<string, { skillId: string; name: string; publisher: string; sum: number; n: number }>();
  for (const r of skillReports) {
    const s = r.skillVersion!.skill;
    const a = skillAgg.get(s.id) ?? { skillId: s.id, name: s.name, publisher: s.publisher.publisher ?? "", sum: 0, n: 0 };
    a.sum += r.score ?? 0;
    a.n += 1;
    skillAgg.set(s.id, a);
  }
  const bySkill = [...skillAgg.values()].map((a) => ({ ...a, avg: a.sum / a.n })).sort((a, b) => b.avg - a.avg).slice(0, 20);
  const models = byModel.sort((a, b) => (b._avg.score ?? 0) - (a._avg.score ?? 0));
  const cell = (model: string, method: string) => byModelMethod.find((r) => r.model === model && r.method === method)?._avg.score;

  return (
    <div className="container-x space-y-12 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">{t("title")}</h1>
          <p className="mt-2 max-w-3xl text-muted">{t("lead")}</p>
        </div>
        <Link href="/crowd/new?kind=evaluation" className="btn-primary">{t("commission")}</Link>
      </div>

      {subjects.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="h2">{te("sectionTitle")}</h2>
              <p className="mt-1 text-sm text-muted">{te("sectionLead")}</p>
            </div>
            <Link href="/benchmarks/evals" className="text-sm text-accent">{te("seeAll")}</Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {subjects.map((e) => (
              <Link key={`${e.kind}|${e.subject}`} href={`/benchmarks/evals?kind=${e.kind}&subject=${encodeURIComponent(e.subject)}`} className="card block p-5 hover:bg-panel-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-accent">{e.kind === "skill" ? te("kindSkill") : te("kindModel")} · {e.subject}</div>
                <h3 className="mt-1 font-semibold">{e.kind === "skill" ? te("headSkill", { subject: e.subject }) : te("headModel", { subject: e.subject })}</h3>
                <div className="mt-2 flex flex-wrap gap-x-4 text-sm text-muted">
                  <span>{te("reportsN", { n: e.n })}</span>
                  {e.best >= 0 && <span>{te("fairShort")} <b className={`font-extrabold ${scoreColor(e.best)}`}>{e.best.toFixed(1)}</b></span>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="h2">{t("models")}</h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">{t("model")}</th>
                <th className="p-3">{t("overall")}</th>
                {EVAL_METHODS.map((m) => (
                  <th key={m} className="p-3">{t(`method.${m}`)}</th>
                ))}
                <th className="p-3">{t("reports")}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((r, i) => (
                <tr key={r.model} className="border-t border-line">
                  <td className="p-3 text-muted">{i + 1}</td>
                  <td className="p-3 font-medium">
                    {catalog.get(r.model)?.label ?? r.model}
                    <div className="text-xs text-muted">{catalog.get(r.model)?.vendor}</div>
                  </td>
                  <td className={`p-3 text-lg font-extrabold ${scoreColor(r._avg.score ?? 0)}`}>{r._avg.score?.toFixed(1)}</td>
                  {EVAL_METHODS.map((m) => {
                    const v = cell(r.model, m);
                    return (
                      <td key={m} className="p-3 font-mono">
                        {v === undefined || v === null ? <span className="text-muted">—</span> : v.toFixed(1)}
                      </td>
                    );
                  })}
                  <td className="p-3 text-muted">{r._count}</td>
                </tr>
              ))}
              {models.length === 0 && (
                <tr>
                  <td colSpan={4 + EVAL_METHODS.length} className="p-8 text-center text-muted">
                    {t("empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">{t("modelsNote", { n: offered })}</p>
      </section>

      {bySkill.length > 0 && (
        <section className="space-y-4">
          <h2 className="h2">{t("skills")}</h2>
          <div className="card divide-y divide-line">
            {bySkill.map((s) => (
              <Link key={s.skillId} href={`/skills/${s.publisher}/${s.name}`} className="flex items-center gap-4 p-4 hover:bg-panel-2">
                <span className={`w-14 text-center text-xl font-extrabold ${scoreColor(s.avg)}`}>{s.avg.toFixed(1)}</span>
                <span className="flex-1 font-mono">{s.publisher}/{s.name}</span>
                <span className="text-sm text-muted">{Number(s.n)} {t("reports")}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="h2">{t("recent")}</h2>
        <div className="card divide-y divide-line">
          {recent.map((r) => (
            <ReportRow key={r.id} r={r} models={labels} />
          ))}
          {recent.length === 0 && <p className="p-8 text-center text-muted">{t("empty")}</p>}
        </div>
      </section>

      <section className="card grid gap-6 p-6 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <h3 className="font-semibold">{t(`how.${i}.title`)}</h3>
            <p className="mt-1 text-sm text-muted">{t(`how.${i}.body`)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
