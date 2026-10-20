import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { modelLabels } from "@/lib/models";
import { LocalDate } from "@/components/date";
import { LIST_SELECT, PUBLIC, board, comparable, sameFamily, suitesOf, toBoardRow, verdict, type Axis, type Contender } from "@/lib/bench-evals";
import { ComboBadge, VerdictChip, fmtTime, fmtUsd, modelName, pct } from "@/components/evals-ui";
import { ComboMatrix, EvalLeaderboard, type LbRow, type MxCell } from "@/components/evals";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ locale: string }>; searchParams: Promise<{ kind?: string; subject?: string; suite?: string }> };

export async function generateMetadata({ params }: P) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "evals" });
  return { title: t("title"), description: t("lead") };
}

export default async function EvalsPage({ params, searchParams }: P) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("evals");
  const labels = await modelLabels();
  const tags = { th: t("th"), ex: t("ex"), solo: t("solo") };
  const kind = sp.kind === "model" ? "model" : "skill";
  const solo = kind === "model";
  const all = await db.benchEval.findMany({ where: { ...PUBLIC, kind }, orderBy: { testedAt: "desc" }, select: LIST_SELECT, take: 2000 });
  const subjects = [...new Map(all.map((r) => [r.subject, r.subject])).keys()].map((s) => ({ s, n: all.filter((r) => r.subject === s).length }));
  const subject = subjects.find((x) => x.s === sp.subject)?.s ?? subjects[0]?.s;
  const mine = all.filter((r) => r.subject === subject);
  const suites = suitesOf(mine);
  const suiteSel = suites.find((x) => sp.suite && x.hash.startsWith(sp.suite))?.hash ?? suites[0]?.hash;
  const { set, other } = comparable(mine, suiteSel);
  const ref = set[0];
  const B = board(set.map((r) => toBoardRow(r)));
  const byId = new Map(B.contenders.map((c) => [c.id, c]));
  const unit = solo ? t("unitModel") : t("unitCombo");
  const badge = (c: { thinkingModel: string; executionModel: string }) => <ComboBadge thinking={c.thinkingModel} execution={c.executionModel} solo={solo} labels={labels} tags={tags} />;
  const fmtAxis = (a: Axis, c: Contender) => (a === "speed" ? fmtTime(c.medianSeconds) : a === "cost" ? fmtUsd(c.costPerPass) : a === "quality" ? c.fairScore.toFixed(1) : c.creativity === null ? "—" : pct(c.creativity));
  const gap = (a: Axis, w: Contender, r: Contender) =>
    a === "speed" ? t("gap.speed", { p: Math.round((1 - w.medianSeconds! / r.medianSeconds!) * 100) })
      : a === "cost" ? t("gap.cost", { p: Math.round((1 - w.costPerPass! / r.costPerPass!) * 100) })
        : a === "quality" ? t("gap.quality", { d: (w.fairScore - r.fairScore).toFixed(1) })
          : t("gap.creativity", { d: Math.round(((w.creativity ?? 0) - (r.creativity ?? 0)) * 100) });
  const short = (c: Contender) => (solo ? modelName(labels, c.thinkingModel) : `${modelName(labels, c.thinkingModel)} + ${modelName(labels, c.executionModel)}`);
  const vOf = (c: { meanScore: number; critFails: number; observations?: number; trials: number; data?: unknown }) =>
    verdict(c.meanScore, c.critFails, c.observations ?? (c.data as { observations?: number })?.observations ?? c.trials);
  const lb: LbRow[] = B.contenders.filter((c) => c.out !== "trial").map((c) => ({
    id: c.id, thinking: c.thinkingModel, execution: c.executionModel, trials: c.trials, observations: c.observations, qualified: c.qualified, rate: c.rate,
    medianSeconds: c.medianSeconds, p90Seconds: c.p90Seconds, costPerPass: c.costPerPass, fairScore: c.fairScore, meanScore: c.meanScore, stdErr: c.stdErr,
    creativity: c.creativity, creativityWins: c.creativityWins, creativityTotal: c.creativityTotal, out: c.out, verdict: vOf(c), eligible: c.eligible,
  }));
  const cells: MxCell[] = B.contenders.map((c) => ({
    id: c.id, thinking: c.thinkingModel, execution: c.executionModel, eligible: c.eligible, trial: c.out === "trial", out: !!c.out && c.out !== "trial",
    single: c.meanScore, values: { speed: c.medianSeconds, cost: c.costPerPass, quality: c.fairScore, creativity: c.creativity },
  }));
  const awardOf = (id: number) => B.awards.filter((a) => a.winner?.id === id || a.tied.some((x) => x.id === id)).map((a) => a.axis);
  const nTrials = mine.reduce((a, r) => a + r.trials, 0);
  const otherSet = new Set(other.filter((r) => r.suiteHash !== ref?.suiteHash || r.judgeModel !== ref?.judgeModel).map((r) => r.id));

  return (
    <div className="container-x py-10">
      <nav className="text-sm text-muted"><Link href="/benchmarks" className="hover:text-accent">{t("back")}</Link></nav>
      <h1 className="h1 mt-3">{t("title")}</h1>
      <p className="mt-2 max-w-3xl text-muted">{t("lead")}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-line bg-panel text-sm">
          {(["skill", "model"] as const).map((k) => (
            <Link key={k} href={`/benchmarks/evals?kind=${k}`} className={`px-4 py-1.5 ${k === kind ? "bg-accent font-semibold text-accent-ink" : ""}`}>
              {k === "skill" ? t("kindSkill") : t("kindModel")}
            </Link>
          ))}
        </div>
        {subjects.map((x) => (
          <Link key={x.s} href={`/benchmarks/evals?kind=${kind}&subject=${encodeURIComponent(x.s)}`} className={`rounded-lg border px-3 py-1 text-sm leading-tight ${x.s === subject ? "border-accent ring-1 ring-accent" : "border-line bg-panel"}`}>
            <span className="font-mono">{x.s}</span>
            <span className="block text-xs text-muted">{t("reportsN", { n: x.n })}</span>
          </Link>
        ))}
      </div>

      {!ref ? (
        <p className="card mt-6 p-8 text-center text-muted">{t("none")}</p>
      ) : (
        <div className="space-y-4">
          <section className="card mt-5 p-5">
            <div className="text-xs text-muted">{solo ? t("kindModel") : t("kindSkill")} · {subject} {ref.subjectVersion}</div>
            <h2 className="mt-1 text-xl font-bold">{solo ? t("headModel", { subject: subject! }) : t("headSkill", { subject: subject! })}</h2>
            {suites.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs text-muted">{t("suitePick")}</span>
                {suites.map((x) => (
                  <Link key={x.hash} href={`/benchmarks/evals?kind=${kind}&subject=${encodeURIComponent(subject!)}&suite=${x.hash.slice(0, 12)}`}
                    className={`rounded-lg border px-3 py-1 leading-tight ${x.hash === ref.suiteHash ? "border-accent ring-1 ring-accent" : "border-line bg-panel"}`}>
                    <span className="font-mono text-xs">sha {x.hash.slice(0, 8)}</span>
                    <span className="block text-xs text-muted">{x.evaluator ? t("suiteBy", { e: x.evaluator }) : t("suiteBuiltin")} · {t("reportsN", { n: x.n })}</span>
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <div className="ev-role"><div className="text-xs text-muted">{solo ? t("standardSuite") : t("useSkill")}</div><div className="font-semibold">{subject} {ref.subjectVersion}</div><div className="text-xs text-muted">{ref.title}</div></div>
              <div className="ev-role"><div className="text-xs text-muted">{t("subjectsUnder")}</div><div className="font-semibold">{solo ? t("nModels", { n: set.length }) : t("nCombos", { n: set.length })}</div><div className="text-xs text-muted">{solo ? t("soloIs") : t("comboIs")}</div></div>
              <div className="ev-role"><div className="text-xs text-muted">{t("judgeFixed")}</div><div className="font-semibold break-all">{ref.judgeModel.replace(/^[^/]+\//, "")}</div><div className="text-xs text-muted">{t("judgeHow")}</div></div>
              <div className="ev-role"><div className="text-xs text-muted">{t("data")}</div><div className="font-semibold">{t("dataN", { reports: mine.length, trials: nTrials })}</div><div className="font-mono text-xs text-muted">{t("suiteHash", { h: ref.suiteHash.slice(0, 4) + "…" + ref.suiteHash.slice(-3) })}</div>{ref.evaluator && <div className="text-xs text-muted">{t("suiteBy", { e: ref.evaluator })}</div>}</div>
            </div>
          </section>

          <section className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="h3">{t("answers", { unit })}</h2><span className="text-xs text-muted">{t("answersNote")}</span></div>
            {B.eligible.length < 2 ? (
              <p className="mt-3 text-sm text-muted">{t("notEnough", { unit })}</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="ev-table min-w-[720px]">
                  <thead><tr><th>{t("colQuestion")}</th><th>{t("colAnswer", { unit })}</th><th className="r">{t("colScore")}</th><th>{t("colGap")}</th><th>{t("colConf")}</th><th className="r">{t("colReport")}</th></tr></thead>
                  <tbody>
                    {B.awards.map((a) => a.winner && (
                      <tr key={a.axis}>
                        <td><b>{t(`q.${a.axis}`)}</b><div className="text-xs text-muted">{t(`unit.${a.axis}`)}</div></td>
                        <td>{badge(a.winner)}{a.tied.length > 0 && <div className="mt-1 text-xs text-muted">{t("tiedWith", { names: a.tied.map(short).join("、") })}</div>}</td>
                        <td className="r font-bold tabular-nums">{fmtAxis(a.axis, a.winner)}</td>
                        <td className="text-xs">{a.runnerUp ? gap(a.axis, a.winner, a.runnerUp) : ""}</td>
                        <td>{a.tied.length ? <span className="ev-chip ev-mid">{t("tie")}</span> : <span className="ev-chip ev-ok">{t("clearLead")}</span>}</td>
                        <td className="r"><Link className="text-accent" href={`/benchmarks/evals/${a.winner.id}`}>#{a.winner.id}</Link></td>
                      </tr>
                    ))}
                    {B.balanced && (
                      <tr>
                        <td><b>{t("balanced")}</b><div className="text-xs text-muted">{t("balancedHow")}</div></td>
                        <td>{badge(B.balanced)}</td>
                        <td className="r font-bold tabular-nums">{Math.round(B.weakest(B.balanced))}</td>
                        <td colSpan={2} className="text-xs">{t("balancedNote", { s: Math.round(B.balanced.norm.speed), c: Math.round(B.balanced.norm.cost), q: Math.round(B.balanced.norm.quality), r: B.balanced.creativity === null ? "—" : Math.round(B.balanced.norm.creativity) })}</td>
                        <td className="r"><Link className="text-accent" href={`/benchmarks/evals/${B.balanced.id}`}>#{B.balanced.id}</Link></td>
                      </tr>
                    )}
                    {B.value && B.awards[2].winner && (
                      <tr>
                        <td><b>{t("value")}</b><div className="text-xs text-muted">{t("valueHow")}</div></td>
                        <td>{badge(B.value)}</td>
                        <td className="r font-bold tabular-nums">{fmtUsd(B.value.costPerPass)}</td>
                        <td colSpan={2} className="text-xs">{B.value.id === B.awards[2].winner.id ? t("valueSame") : t("valueNote", { q: B.value.fairScore.toFixed(1), p: Math.round((1 - (B.value.costPerPass ?? 0) / (B.awards[2].winner.costPerPass || 1)) * 100) })}</td>
                        <td className="r"><Link className="text-accent" href={`/benchmarks/evals/${B.value.id}`}>#{B.value.id}</Link></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {!solo && cells.length > 0 && (
            <section className="card p-5">
              <h2 className="h3">{t("matrix")}</h2>
              <div className="mt-2"><ComboMatrix cells={cells} labels={labels} /></div>
              <p className="mt-2 text-xs text-muted">{t("matrixNote")}</p>
            </section>
          )}

          {lb.length > 0 && (
            <section className="card p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="h3">{t("ranking", { unit })}</h2><span className="text-xs text-muted">{t("rankingNote")}</span></div>
              <EvalLeaderboard rows={lb} solo={solo} labels={labels} />
            </section>
          )}

          <section className="card p-5">
            <h2 className="h3">{t("reports")}</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="ev-table min-w-[760px]">
                <thead><tr><th>{t("colReport")}</th><th>{unit}</th><th className="r">{t("colN")}</th><th className="r">{t("colScore")}</th><th>{t("colVerdict")}</th><th>{t("colEvaluator")}</th><th>{t("colTags")}</th><th>{t("colDate")}</th></tr></thead>
                <tbody>
                  {mine.map((r) => {
                    const c = byId.get(r.id);
                    const v = vOf(r);
                    const trial = r.trials < 3;
                    return (
                      <tr key={r.id}>
                        <td><Link className="text-accent" href={`/benchmarks/evals/${r.id}`}>#{r.id}</Link></td>
                        <td>{badge(r)}</td>
                        <td className="r tabular-nums">{r.trials}</td>
                        <td className="r tabular-nums"><b>{(trial ? r.meanScore : r.fairScore).toFixed(1)}</b><div className="text-xs text-muted">{trial ? t("singleShort") : t("fairShort")}</div></td>
                        <td><VerdictChip v={v} label={t(`verdict.${v}`)} /></td>
                        <td className="whitespace-nowrap text-xs"><span className="font-mono">{r.evaluator ?? "—"}</span><div className="font-mono text-muted">sha {r.suiteHash.slice(0, 6)}</div></td>
                        <td>
                          {trial && <span className="ev-chip ev-mid">{t("tagTrial")}</span>}
                          {c?.out === "critical" && <span className="ev-chip ev-bad">{t("why.critical")}</span>}
                          {c?.out === "rate" && <span className="ev-chip ev-bad">{t("why.rate", { p: pct(c.rate) })}</span>}
                          {otherSet.has(r.id) && <span className="ev-chip">{t("tagOtherSuite")}</span>}
                          {sameFamily(r.judgeModel, r.thinkingModel, r.executionModel) && <span className="ev-chip ev-mid" title={t("tagSameFamilyTip")}>{t("tagSameFamily")}</span>}
                          {awardOf(r.id).map((a) => <span key={a} className="ev-chip ev-ok">{t(`award.${a}`)}</span>)}
                          {B.balanced?.id === r.id && <span className="ev-chip ev-ok">{t("tagBalanced")}</span>}
                        </td>
                        <td className="whitespace-nowrap text-xs text-muted"><LocalDate value={r.testedAt} withTime={false} /><div>{r.publisher.publisher ?? (r.publisher.handle ? `@${r.publisher.handle}` : r.publisher.account.slice(0, 10))}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="card p-4 text-xs text-muted"><b className="text-ink">{t("howTitle")}</b>{t("howBody")}</p>
        </div>
      )}
    </div>
  );
}
