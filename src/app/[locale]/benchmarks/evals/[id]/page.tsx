import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { modelLabels } from "@/lib/models";
import { Markdown } from "@/components/markdown";
import { LocalDate } from "@/components/date";
import { LIST_SELECT, PUBLIC, board, categoryRates, comparable, family, reportStats, sameFamily, toBoardRow, verdict, weightsOf, type Axis, type Contender, type EvalTask } from "@/lib/bench-evals";
import { Bar, ComboBadge, Radar, fmtTime, fmtTok, fmtUsd, modelName, pct } from "@/components/evals-ui";
import { CopyLink, QuestionTable, VisibilityToggle, type QTask } from "@/components/evals";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ locale: string; id: string }> };
type Data = { tasks: EvalTask[]; threshold: number; judgeCheck: { total: number; correct: number } | null; judge2Agree: [number, number] | null; creativity: { wins: number; total: number; combos?: number | null } | null; runs: string[] };

async function load(id: string) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const r = await db.benchEval.findUnique({
    where: { id: n },
    include: {
      publisher: true,
      benchSuite: { select: { hash: true, evaluator: true, evaluatorVersion: true, reportCount: true, evaluatorSkillVersion: { select: { skill: { select: { name: true, publisher: { select: { publisher: true } } } } } } } },
      skillVersion: { select: { version: true, skill: { select: { name: true, publisher: { select: { publisher: true } } } } } },
    },
  });
  if (!r || r.hidden) return null;
  if (r.visibility !== "public") {          // a private report: its publisher only
    const u = await currentUser().catch(() => null);
    if (!u || u.id !== r.publisherId) return null;
  }
  return r;
}

export async function generateMetadata({ params }: P) {
  const r = await load((await params).id);
  return r ? { title: `#${r.id} ${r.subject}: ${r.thinkingModel === r.executionModel ? r.thinkingModel : `${r.thinkingModel} + ${r.executionModel}`}`, description: r.summary.slice(0, 200) } : {};
}

export default async function EvalReportPage({ params }: P) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("evals");
  const labels = await modelLabels();
  const r = await load(id);
  if (!r) notFound();
  const d = r.data as unknown as Data;
  const solo = r.kind === "model";
  const unit = solo ? t("unitModel") : t("unitCombo");
  const tags = { th: t("th"), ex: t("ex"), solo: t("solo") };
  const s = reportStats({ tasks: d.tasks, threshold: d.threshold ?? 70 });
  const v = verdict(s.mean, s.critFails, s.observations);
  const name = (m: string) => modelName(labels, m);

  // its place among the comparable reports of the subject
  const sibs = await db.benchEval.findMany({ where: { ...PUBLIC, kind: r.kind, subject: r.subject }, select: LIST_SELECT });
  const { set } = comparable(r.visibility === "public" ? sibs : [...sibs, { ...sibs[0], ...r }].filter(Boolean), r.suiteHash);
  const B = board(set.map((x) => toBoardRow(x)));
  const me = B.contenders.find((c) => c.id === r.id);
  const fmtAxis = (a: Axis, c: Contender) => (a === "speed" ? fmtTime(c.medianSeconds) : a === "cost" ? fmtUsd(c.costPerPass) : a === "quality" ? c.fairScore.toFixed(1) : c.creativity === null ? "—" : pct(c.creativity));
  const qBest = B.awards[2].winner;

  // answers over every task and trial
  const n = s.n;
  const allTrials = s.scored.flatMap((x) => x.trials.map((tr) => ({ task: x.task, ...tr })));
  const failedQs = [...new Set(s.scored.flatMap((x) => x.task.questions.filter((_, i) => x.trials.some((tr) => !tr.x.grades[i]?.ok)).map((q) => q.label)))];
  const cats = new Map<string, { weight: number; passed: number; total: number }>();
  for (const x of s.scored) for (const tr of x.trials) for (const c of categoryRates(x.task, tr.x.grades.map((g) => g.ok))) {
    const o = cats.get(c.name) ?? { weight: c.weight, passed: 0, total: 0 };
    o.passed += c.passed;
    o.total += c.total;
    cats.set(c.name, o);
  }
  const catList = [...cats.entries()].map(([nm, o]) => ({ name: nm, weight: o.weight, rate: o.total ? o.passed / o.total : 0 }));
  const sorted = [...catList].sort((a, b) => b.rate - a.rate);
  const blame = { skill: 0, thinking: 0, execution: 0, unsure: 0 };
  const top: Record<string, Map<string, number>> = { skill: new Map(), thinking: new Map(), execution: new Map(), unsure: new Map() };
  for (const tr of allTrials) tr.x.grades.forEach((g, i) => {
    const q = tr.task.questions[i];
    if (!q) return;
    if (!g.ok) {
      blame[q.owner] += 1;
      top[q.owner].set(q.label, (top[q.owner].get(q.label) ?? 0) + 1);
    }
    if (g.votes && g.votes[0] !== 0 && g.votes[0] !== g.votes[1]) {
      blame.unsure += 1;
      top.unsure.set(q.label, (top.unsure.get(q.label) ?? 0) + 1);
    }
  });
  const topOf = (k: string) => [...top[k].entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const qTasks: QTask[] = s.scored.map((x) => ({
    id: x.task.id, title: x.task.title,
    cats: Object.entries(weightsOf(x.task)).map(([nm, w]) => {
      const rates = x.trials.map((tr) => categoryRates(x.task, tr.x.grades.map((g) => g.ok)).find((c) => c.name === nm)!);
      return { name: nm, weight: w, rate: rates.reduce((a, c) => a + c.passed, 0) / (rates.reduce((a, c) => a + c.total, 0) || 1) };
    }),
    rows: x.task.questions.map((q, i) => {
      const firstNo = x.trials.find((tr) => !tr.x.grades[i]?.ok);
      const g = (firstNo ?? x.trials[0]).x.grades[i];
      return { i: i + 1, label: q.label, category: q.category, kind: q.kind, critical: q.critical, owner: q.owner, oks: x.trials.map((tr) => !!tr.x.grades[i]?.ok), evidence: [g?.detail, g?.evidence].filter(Boolean).join(" · ") };
    }),
  }));

  // deterministic share of the weight (first task)
  const t0 = d.tasks[0];
  const w0 = weightsOf(t0);
  const wTotal = Object.values(w0).reduce((a, b) => a + b, 0) || 1;
  const detShare = t0.questions.reduce((a, q) => a + (q.kind === "det" ? (w0[q.category] ?? 0) / t0.questions.filter((x) => x.category === q.category).length : 0), 0) / wTotal;

  // trial 1 of the first task: process and output
  const tr1 = t0.trials[0];
  const steps = tr1.steps_trace;
  const maxStep = Math.max(1, ...steps.map((x) => x.tokens));
  const stageRows = (stage: string) => t0.questions.map((q, i) => ({ q, i, ok: !!tr1.grades[i]?.ok, g: tr1.grades[i] })).filter((x) => x.q.stage === stage);
  const roles = tr1.roles ?? {};
  const thTok = (roles.thinking?.input_tokens ?? 0) + (roles.thinking?.output_tokens ?? 0);
  const exTok = (roles.execution?.input_tokens ?? 0) + (roles.execution?.output_tokens ?? 0);
  const texts = tr1.outputs.filter((o) => o.kind === "text" && o.text);
  const evid = t0.questions.map((q, i) => ({ q, i, g: tr1.grades[i] })).filter((x) => x.g && (x.g.evidence || !x.g.ok));
  const fam = sameFamily(r.judgeModel, r.thinkingModel, r.executionModel);
  const url = `${config.origin}/${locale}/benchmarks/evals/${r.id}`;
  const evSkill = r.benchSuite?.evaluatorSkillVersion?.skill ?? null;
  // the 安全性 questions (sandbox record, SinoBee evals/sandbox.py) over every task and trial
  const secMap = new Map<string, { label: string; ok: number; total: number; critical: boolean; detail: string }>();
  for (const x of s.scored) x.task.questions.forEach((q, i) => {
    if (q.category !== "安全性") return;
    const o = secMap.get(q.label) ?? { label: q.label, ok: 0, total: 0, critical: q.critical, detail: "" };
    for (const tr of x.trials) {
      o.total += 1;
      if (tr.x.grades[i]?.ok) o.ok += 1;
      else if (!o.detail) o.detail = tr.x.grades[i]?.detail ?? "";
    }
    secMap.set(q.label, o);
  });
  const security = [...secMap.values()];
  const who = r.publisher.publisher ?? (r.publisher.handle ? `@${r.publisher.handle}` : r.publisher.account);

  // a stage lists what failed and its critical questions; the rest is counted
  const stageList = (stage: string) => {
    const every = stageRows(stage);
    const rows = every.filter((x) => !x.ok || x.q.critical);
    const more = every.length - rows.length;
    return every.length ? (<>
      {rows.length > 0 && <table className="ev-table mt-1"><tbody>
        {rows.map((x) => (
          <tr key={x.i}><td className="w-8 text-center">{x.ok ? <span className="ev-yes">{t("yes")}</span> : <span className="ev-no">{t("no")}</span>}</td>
            <td>{x.q.label}<div className="text-xs text-muted"><span className={`ev-chip ${x.q.kind === "det" ? "ev-det" : "ev-judge"}`}>{t(`kind.${x.q.kind}`)}</span>{x.q.critical && <span className="ev-chip ev-crit">{t("critical")}</span>}{x.g?.detail}</div></td></tr>
        ))}
      </tbody></table>}
      {more > 0 && <p className="mt-1 text-xs text-muted">{t("moreOk", { n: more })}</p>}
    </>) : null;
  };
  const tone = (stage: string) => (stageRows(stage).some((x) => !x.ok) ? (stageRows(stage).some((x) => !x.ok && x.q.critical) ? "bad" : "mid") : "");

  return (
    <div className="container-x space-y-4 py-10">
      <nav className="text-sm text-muted">
        <Link href="/benchmarks" className="hover:text-accent">{t("back")}</Link> › <Link href={`/benchmarks/evals?kind=${r.kind}&subject=${encodeURIComponent(r.subject)}`} className="hover:text-accent">{r.subject}</Link> › #{r.id}
      </nav>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="text-xs text-muted">{t("reportOf", { kind: solo ? t("kindModel") : t("kindSkill"), subject: r.subject, v: r.subjectVersion, id: r.id })}</div>
          <span className="flex flex-wrap items-center gap-2">
            {(await currentUser().catch(() => null))?.id === r.publisherId ? <VisibilityToggle id={r.id} visibility={r.visibility} /> : null}
            {r.visibility === "public" && <CopyLink url={url} />}
          </span>
        </div>
        <h1 className="mt-1 text-xl font-bold sm:text-2xl">{t0.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">{solo ? t("unitTestedModel") : t("unitTested")} <ComboBadge thinking={r.thinkingModel} execution={r.executionModel} solo={solo} labels={labels} tags={tags} /></div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="ev-role"><div className="text-xs text-muted">{solo ? t("roleSuite") : t("roleSkill")}</div><div className="font-semibold">{r.subject} {r.subjectVersion}</div><div className="text-xs text-muted">{t("roleSkillSub", { suite: r.suite })}</div></div>
          {solo ? (
            <div className="ev-role th col-span-1 lg:col-span-2"><div className="text-xs text-muted">{t("roleModel")}</div><div className="font-semibold">{name(r.thinkingModel)}</div><div className="text-xs text-muted">{t("roleModelSub")}</div></div>
          ) : (
            <>
              <div className="ev-role th"><div className="text-xs text-muted">{t("roleThinking")}</div><div className="font-semibold">{name(r.thinkingModel)}</div><div className="text-xs text-muted">{t("roleThinkingSub")}</div></div>
              <div className="ev-role ex"><div className="text-xs text-muted">{t("roleExecution")}</div><div className="font-semibold">{name(r.executionModel)}</div><div className="text-xs text-muted">{t("roleExecutionSub")}</div></div>
            </>
          )}
          <div className="ev-role"><div className="text-xs text-muted">{t("roleJudge")}</div><div className="font-semibold">{name(r.judgeModel)}</div><div className="text-xs text-muted">{t("roleJudgeSub")}</div></div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="ev-stat"><div className="text-xs text-muted">{t("statTested")}</div><div className="font-bold"><LocalDate value={r.testedAt} withTime={false} /></div><div className="text-xs text-muted"><LocalDate value={r.testedAt} />{r.testedUntil && <> – <LocalDate value={r.testedUntil} /></>}</div></div>
          <div className="ev-stat"><div className="text-xs text-muted">{t("statSpeed")}</div><div className="text-lg font-bold tabular-nums">{fmtTime(s.medianSeconds)}</div><div className="text-xs text-muted">{s.p90Seconds !== null && t("p90", { t: fmtTime(s.p90Seconds) })}</div></div>
          <div className="ev-stat"><div className="text-xs text-muted">{t("statCost")}</div><div className="text-lg font-bold tabular-nums">{fmtUsd(s.costPerPass)}</div><div className="text-xs text-muted">{t("statCostSub", { t: fmtTok(s.tokens) })}</div></div>
          <div className="ev-stat"><div className="text-xs text-muted">{t("statTrials")}</div><div className="text-lg font-bold">{t("statTrialsV", { q: s.qualified, n: s.observations })}</div><div className="text-xs text-muted">{t("statTrialsSub", { v: r.clientVersion ?? "" })}</div></div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="h3">{t("overall")}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-5">
          <div><div className="text-5xl font-extrabold leading-none tabular-nums">{s.fair.toFixed(1)}</div><div className="mt-1 text-xs text-muted">{t("fairOf", { n })}</div></div>
          <div className={`ev-verdict ${v} min-w-[260px] flex-1 text-sm`}>
            <b>{t(`verdict.${v}`)}</b>：{t(`verdictText.${v}`, { m: s.mean.toFixed(1), crit: s.critFails ? t("critNote", { n: s.critFails }) : "" })}{" "}
            {failedQs.length ? t("failedSummary", { n: failedQs.length, list: failedQs.slice(0, 6).join("、") }) : t("noFails")}
          </div>
        </div>
        {me && (
          <>
            <h3 className="mt-4 text-sm font-semibold">{t("position", { subject: r.subject, n: B.eligible.length, unit })}</h3>
            {me.eligible ? (
              <div className="overflow-x-auto">
                <table className="ev-table min-w-[560px]">
                  <thead><tr><th>{t("colQuestion")}</th><th className="r">{t("posValue", { unit })}</th><th className="r">{t("posRank")}</th><th>{t("posWinner")}</th><th className="r">{t("posGap")}</th></tr></thead>
                  <tbody>
                    {B.awards.map((a) => {
                      const rank = a.rank.findIndex((c) => c.id === me.id) + 1;
                      const win = a.winner?.id === me.id;
                      const tied = a.tied.some((c) => c.id === me.id);
                      const w = a.winner;
                      const gapV = !w || win ? "—" : a.axis === "speed" ? t("posGapV.speed", { p: Math.round(((me.medianSeconds ?? 0) / (w.medianSeconds || 1) - 1) * 100) })
                        : a.axis === "cost" ? t("posGapV.cost", { p: Math.round(((me.costPerPass ?? 0) / (w.costPerPass || 1) - 1) * 100) })
                          : a.axis === "quality" ? t("posGapV.quality", { d: (w.fairScore - me.fairScore).toFixed(1) }) : t("posGapV.creativity", { d: Math.round(((w.creativity ?? 0) - (me.creativity ?? 0)) * 100) });
                      return (
                        <tr key={a.axis}>
                          <td>{t(`q.${a.axis}`)}<div className="text-xs text-muted">{t(`unit.${a.axis}`)}</div></td>
                          <td className="r font-bold tabular-nums">{fmtAxis(a.axis, me)}</td>
                          <td className="r">{win ? <span className="ev-chip ev-ok">{t("first")}</span> : tied ? <span className="ev-chip ev-ok">{t("firstTied")}</span> : rank ? t("rankOf", { r: rank, n: a.rank.length }) : "—"}</td>
                          <td>{win ? t("self", { unit }) : w ? <ComboBadge thinking={w.thinkingModel} execution={w.executionModel} solo={solo} labels={labels} tags={tags} /> : "—"}</td>
                          <td className="r text-xs tabular-nums">{gapV}</td>
                        </tr>
                      );
                    })}
                    <tr><td colSpan={5} className="text-xs text-muted">
                      {B.balanced?.id === me.id && <b className="text-ink">{t("isBalanced", { unit, w: Math.round(B.weakest(me)) })} </b>}
                      {qBest && qBest.id !== me.id && me.costPerPass !== null && qBest.costPerPass && me.medianSeconds && qBest.medianSeconds && t("vsQuality", { c: Math.round((1 - me.costPerPass / qBest.costPerPass) * 100), s: Math.round((1 - me.medianSeconds / qBest.medianSeconds) * 100) })}
                    </td></tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">{t("notRanked", { why: me.out === "rate" ? t("why.rate", { p: pct(me.rate) }) : t(`why.${me.out}`) })}</p>
            )}
          </>
        )}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-[260px] flex-1">
            <h2 className="h3">{t("profile")}</h2>
            <div className="mt-2 space-y-2">
              {catList.map((c) => (
                <div key={c.name} className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-sm">
                  <span>{c.name} <span className="text-xs text-muted">×{c.weight}</span></span>
                  <Bar value={c.rate} />
                  <span className="text-right tabular-nums">{pct(c.rate)}</span>
                </div>
              ))}
            </div>
            {sorted.length > 1 && <p className="mt-2 text-xs"><b>{t("strongest")}</b> {sorted[0].name} {pct(sorted[0].rate)}　<b>{t("weakest")}</b> {sorted[sorted.length - 1].name} {pct(sorted[sorted.length - 1].rate)}</p>}
          </div>
          <Radar items={catList.map((c) => ({ name: c.name, value: c.rate }))} />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="h3">{t("io")} <span className="text-xs font-normal text-muted">{t("ioTrial")}</span></h2>
        <div className="ev-split mt-2">
          <div>
            <div className="text-xs text-muted">{t("input", { unit })}</div>
            {d.tasks.map((x) => <pre key={x.id} className="ev-pre mt-1">{x.prompt}</pre>)}
            {r.inputHash && <p className="mt-1 text-xs text-muted">{t("inputHash", { h: r.inputHash.slice(0, 4) + "…" + r.inputHash.slice(-3), unit })}</p>}
          </div>
          <div>
            <div className="text-xs text-muted">{t("output")}: {tr1.outputs.map((o) => o.path.split("/").pop()).join(" · ")}</div>
            <div className="ev-out mt-1">{texts.length ? texts.map((o) => <Markdown key={o.path}>{o.text!.replace(/!\[[^\]]*\]\([^)]*\)/g, "")}</Markdown>) : <p className="py-3 text-sm text-muted">{t("noText")}</p>}</div>
          </div>
        </div>
        {evid.length > 0 && (
          <>
            <h3 className="mt-3 text-sm font-semibold">{t("evidence")}</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {evid.map((x) => (
                <li key={x.i}><a href={`#q-${t0.id}-${x.i + 1}`} className={`mr-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${x.g.ok ? "bg-ok" : "bg-err"}`}>{x.i + 1}</a>{x.q.label}<span className="text-xs text-muted"> — {x.g.evidence || x.g.detail}</span></li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card p-5">
        <h2 className="h3">{t("detail", { c: catList.length, q: d.tasks.reduce((a, x) => a + x.questions.length, 0), n })}</h2>
        <QuestionTable tasks={qTasks} n={n} />
      </section>

      <section className="card p-5">
        <h2 className="h3">{solo ? t("blameModel") : t("blame")}</h2>
        <div className="ev-blame mt-2">
          {(solo ? (["skill", "execution", "unsure"] as const) : (["skill", "thinking", "execution", "unsure"] as const)).map((k) => (
            <div key={k} className={k === "thinking" ? "th" : k === "execution" ? "ex" : ""}>
              <span className="text-xs text-muted">{k === "unsure" ? t("unsure") : k === "skill" ? `${t("owner.skill")} ${r.subject}` : k === "thinking" ? `${t("owner.thinking")} ${name(r.thinkingModel)}` : solo ? name(r.executionModel) : `${t("owner.execution")} ${name(r.executionModel)}`}</span>
              <b className="block text-xl tabular-nums">{t("times", { n: blame[k] })}</b>
              <span className="text-xs text-muted">{k === "unsure" && !topOf(k) ? t("unsureNote") : topOf(k) ? t("blameTop", { q: topOf(k)! }) : ""}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{t("blameNote")}</p>
      </section>

      <section className="card p-5">
        <h2 className="h3">{t("process")} <span className="text-xs font-normal text-muted">{t("processSub", { t: fmtTime(tr1.duration_s), tok: fmtTok(tr1.input_tokens + tr1.output_tokens) })}</span></h2>
        <div className="ev-tl mt-3">
          <div className={`ev-stage ${tone("plan")}`}>
            <h3 className="text-sm font-semibold">{t("stage.plan")} <span className="text-xs font-normal text-muted">{t("stageWho.plan", { m: name(r.thinkingModel), tok: fmtTok(thTok) })}</span></h3>
            {stageList("plan")}
          </div>
          <div className={`ev-stage ${tone("exec")}`}>
            <h3 className="text-sm font-semibold">{t("stage.exec")} <span className="text-xs font-normal text-muted">{t("stageWho.exec", { m: name(r.executionModel), n: steps.length || tr1.steps, tok: fmtTok(exTok || tr1.input_tokens + tr1.output_tokens) })}</span></h3>
            {steps.length > 0 && (
              <>
                <div className="ev-steps" role="img" aria-label={t("stepsNote")}>
                  {steps.map((x, k) => <i key={k} className={x.failed || x.retries ? "f" : ""} style={{ height: `${Math.max(4, (x.tokens / maxStep) * 100)}%`, animationDelay: `${k * 30}ms` }} title={`#${x.step ?? k + 1} · ${fmtTok(x.tokens)} · ${fmtTime(x.wall_s)}`} />)}
                </div>
                <p className="text-xs text-muted">{t("stepsNote")}</p>
              </>
            )}
            {stageList("exec")}
          </div>
          {stageRows("review").length > 0 && (
            <div className={`ev-stage ${tone("review")}`}>
              <h3 className="text-sm font-semibold">{t("stage.review")} <span className="text-xs font-normal text-muted">{t("stageWho.review", { m: name(r.thinkingModel) })}</span></h3>
              {stageList("review")}
            </div>
          )}
          <div className={`ev-stage ${tone("output")}`}>
            <h3 className="text-sm font-semibold">{t("stage.output")} <span className="text-xs font-normal text-muted">{t("stageWho.output", { n: tr1.outputs.length })}</span></h3>
            {stageList("output")}
          </div>
          <div className="ev-stage">
            <h3 className="text-sm font-semibold">{t("stage.judge")} <span className="text-xs font-normal text-muted">{t("stageWho.judge", { m: name(r.judgeModel), a: d.judgeCheck ? `${d.judgeCheck.correct}/${d.judgeCheck.total}` : "—", unit })}</span></h3>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="h3">{t("trials")}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="ev-table min-w-[560px]">
            <thead><tr><th>{t("colTrial")}</th><th className="r">{t("colQ")}</th><th className="r">{t("colTime")}</th><th className="r">{t("colCost")}</th><th className="r">{t("colNo")}</th><th>{t("colResult")}</th></tr></thead>
            <tbody>
              {s.trialQ.map((q, i) => {
                const at = s.scored.map((x) => x.trials[i]);
                const ok = at.every((x) => x.qualified);
                return (
                  <tr key={i}>
                    <td>#{i + 1}</td>
                    <td className="r font-bold tabular-nums">{q.toFixed(1)}</td>
                    <td className="r tabular-nums">{fmtTime(at.reduce((a, x) => a + x.x.duration_s, 0))}</td>
                    <td className="r tabular-nums">{fmtUsd(at.reduce((a, x) => a + x.x.cost_usd, 0))}</td>
                    <td className="r tabular-nums">{at.reduce((a, x) => a + x.x.grades.filter((g) => !g.ok).length, 0)}</td>
                    <td>{ok ? <span className="ev-yes">{t("qualifiedT")}</span> : <span className="ev-no">{t("notQualified")}</span>}</td>
                  </tr>
                );
              })}
              <tr><td colSpan={6} className="text-xs">{t("fairCalc", { m: s.mean.toFixed(2), se: s.se.toFixed(2), f: s.fair.toFixed(2), unit })}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      {security.length > 0 && (
        <section className="card p-5">
          <h2 className="h3">{t("security")}</h2>
          <p className="mt-1 text-xs text-muted">{t("securityNote")}</p>
          <table className="ev-table mt-2 text-sm"><tbody>
            {security.map((x) => (
              <tr key={x.label}><td>{x.label}{x.critical && <span className="ev-chip ev-crit">{t("critical")}</span>}</td>
                <td className="r tabular-nums"><b className={x.ok === x.total ? "text-ok" : "text-err"}>{x.ok}/{x.total}</b></td>
                <td className="text-xs text-muted">{x.ok === x.total ? "" : x.detail}</td></tr>
            ))}
          </tbody></table>
        </section>
      )}

      <section className="card p-5">
        <h2 className="h3">{t("conditions")}</h2>
        <table className="ev-table mt-2 text-sm">
          <tbody>
            <tr><td className="w-36 text-muted">{t("cTime")}</td><td><LocalDate value={r.testedAt} />{r.testedUntil && <> – <LocalDate value={r.testedUntil} /></>}</td></tr>
            <tr><td className="text-muted">{t("cSuite")}</td><td>{t("cSuiteV", { suite: r.suite, v: r.subjectVersion, h: r.suiteHash.slice(0, 4) + "…" + r.suiteHash.slice(-3) })}</td></tr>
            {(r.evaluator || r.benchSuite) && <tr><td className="text-muted">{t("cEvaluator")}</td><td>
              {evSkill ? <Link className="font-mono text-accent" href={`/skills/${evSkill.publisher.publisher}/${evSkill.name}`}>{r.evaluator ?? `${r.benchSuite!.evaluator}@${r.benchSuite!.evaluatorVersion}`}</Link> : <span className="font-mono">{r.evaluator ?? `${r.benchSuite!.evaluator}@${r.benchSuite!.evaluatorVersion}`}</span>}
              {r.benchSuite && <> · <a className="text-accent" href={`/api/v1/evals/suites/${r.benchSuite.hash}`}>{t("cSuiteDownload")}</a> · {t("reportsN", { n: r.benchSuite.reportCount })}</>}</td></tr>}
            {r.skillVersion && <tr><td className="text-muted">{t("cSkill")}</td><td><Link className="font-mono text-accent" href={`/skills/${r.skillVersion.skill.publisher.publisher}/${r.skillVersion.skill.name}?v=${r.skillVersion.version}`}>{r.skillVersion.skill.publisher.publisher}/{r.skillVersion.skill.name}@{r.skillVersion.version}</Link></td></tr>}
            {r.inputHash && <tr><td className="text-muted">{t("cInput")}</td><td className="font-mono text-xs break-all">{r.inputHash}</td></tr>}
            <tr><td className="text-muted">{t("cJudge")}</td><td>{t("cJudgeV", { m: name(r.judgeModel) })}{d.judgeCheck && <> · {d.judgeCheck.correct === d.judgeCheck.total ? t("cAnchors", { c: d.judgeCheck.correct, t: d.judgeCheck.total }) : <span className="text-err">{t("cAnchorsBad", { c: d.judgeCheck.correct, t: d.judgeCheck.total })}</span>}</>}</td></tr>
            <tr><td className="text-muted">{t("cFamily")}</td><td>{fam ? t("cFamilyYes", { f: family(r.judgeModel) }) : t("cFamilyNo")}{r.judge2Model && d.judge2Agree && t("cJudge2", { m: name(r.judge2Model), a: d.judge2Agree[0], n: d.judge2Agree[1] })}</td></tr>
            <tr><td className="text-muted">{t("cDet")}</td><td>{t("cDetV", { p: (detShare * 100).toFixed(1) })}</td></tr>
            {d.creativity && <tr><td className="text-muted">{t("cCreativity")}</td><td>{t("cCreativityV", { n: Math.max(1, (d.creativity.combos ?? 2) - 1), unit, w: d.creativity.wins, t: d.creativity.total })}</td></tr>}
            <tr><td className="text-muted">{t("cClient")}</td><td>SinoBee {r.clientVersion} · <span className="font-mono text-xs">{who}</span></td></tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
