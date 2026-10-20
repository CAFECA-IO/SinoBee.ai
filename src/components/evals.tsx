"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ComboBadge, VerdictChip, fmtTime, fmtUsd, pct } from "./evals-ui";

export type Axis = "speed" | "cost" | "quality" | "creativity";
const AXES: Axis[] = ["speed", "cost", "quality", "creativity"];
const LOW: Record<Axis, boolean> = { speed: true, cost: true, quality: false, creativity: false };

export type LbRow = {
  id: number; thinking: string; execution: string; trials: number; observations: number; qualified: number; rate: number;
  medianSeconds: number | null; p90Seconds: number | null; costPerPass: number | null; fairScore: number; meanScore: number; stdErr: number;
  creativity: number | null; creativityWins: number | null; creativityTotal: number | null;
  out: null | "trial" | "critical" | "rate"; verdict: "done" | "partial" | "failed"; eligible: boolean;
};
const val = (r: LbRow, a: Axis) => (a === "speed" ? r.medianSeconds : a === "cost" ? r.costPerPass : a === "quality" ? r.fairScore : r.creativity);
function show(r: LbRow, a: Axis) {
  if (a === "quality") return r.fairScore.toFixed(1);
  if (!r.eligible) return "—";
  return a === "speed" ? fmtTime(r.medianSeconds) : a === "cost" ? fmtUsd(r.costPerPass) : r.creativity === null ? "—" : pct(r.creativity);
}

function useTags() {
  const t = useTranslations("evals");
  return { th: t("th"), ex: t("ex"), solo: t("solo") };
}

/** The ranking (L): sort by any axis, set limits on wait, cost and quality; rows that fail a limit sink and say why */
export function EvalLeaderboard({ rows, solo, labels }: { rows: LbRow[]; solo: boolean; labels: Record<string, string> }) {
  const t = useTranslations("evals");
  const tags = useTags();
  const maxT = Math.max(60, ...rows.map((r) => r.p90Seconds ?? r.medianSeconds ?? 0));
  const tTop = Math.ceil(maxT / 10) * 10 + 20;
  const cTop = Math.max(0.5, Math.ceil(Math.max(...rows.map((r) => r.costPerPass ?? 0)) * 10) / 10 + 0.1);
  const [axis, setAxis] = useState<Axis>("quality");
  const [wait, setWait] = useState(tTop);
  const [cost, setCost] = useState(cTop);
  const [minQ, setMinQ] = useState(0);
  const why = (r: LbRow) => {
    if (r.out) return [r.out === "rate" ? t("why.rate", { p: pct(r.rate) }) : t(`why.${r.out}`)];
    const w: string[] = [];
    if ((r.medianSeconds ?? 0) > wait) w.push(t("why.time", { t: fmtTime(r.medianSeconds) }));
    if ((r.costPerPass ?? 0) > cost) w.push(t("why.cost", { c: fmtUsd(r.costPerPass) }));
    if (r.fairScore < minQ) w.push(t("why.quality", { q: r.fairScore.toFixed(1), m: minQ }));
    return w;
  };
  const ok = rows.filter((r) => !why(r).length).sort((a, b) => {
    const x = val(a, axis), y = val(b, axis);
    if (x === null) return 1;
    if (y === null) return -1;
    return LOW[axis] ? x - y : y - x;
  });
  const no = rows.filter((r) => why(r).length);
  const order = [...ok, ...no];
  // smooth re-ordering (FLIP): rows slide from where they were
  const body = useRef<HTMLTableSectionElement>(null);
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((tr) => {
      const top = tr.getBoundingClientRect().top;
      const before = last.current.get(tr.dataset.id!);
      last.current.set(tr.dataset.id!, top);
      if (reduce || before === undefined || before === top) return;
      tr.style.transition = "none";
      tr.style.transform = `translateY(${before - top}px)`;
      requestAnimationFrame(() => {
        tr.style.transition = "transform .45s cubic-bezier(.2,.8,.2,1)";
        tr.style.transform = "";
      });
    });
  });
  const best = ok[0];
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-xs text-muted">
          {t("maxWait")} <b className="text-ink">{fmtTime(wait)}</b>
          <input type="range" className="mt-1 w-full accent-[var(--accent)]" min={30} max={tTop} step={10} value={wait} onChange={(e) => setWait(+e.target.value)} />
        </label>
        <label className="block text-xs text-muted">
          {t("maxCost")} <b className="text-ink">{fmtUsd(cost)}</b>
          <input type="range" className="mt-1 w-full accent-[var(--accent)]" min={0.05} max={cTop} step={0.05} value={cost} onChange={(e) => setCost(+e.target.value)} />
        </label>
        <label className="block text-xs text-muted">
          {t("minQuality")} <b className="text-ink">{minQ}</b>
          <input type="range" className="mt-1 w-full accent-[var(--accent)]" min={0} max={95} step={1} value={minQ} onChange={(e) => setMinQ(+e.target.value)} />
        </label>
      </div>
      <div className="ev-rec mt-3">
        {best ? (
          <span className="flex flex-wrap items-center gap-2">
            <b>{t("rec", { axis: t(`axis.${axis}`) })}</b>
            <ComboBadge thinking={best.thinking} execution={best.execution} solo={solo} labels={labels} tags={tags} />
            <span className="text-xs text-muted">{AXES.map((a) => `${t(`axis.${a}`)} ${show(best, a)}`).join(" · ")}</span>
          </span>
        ) : (
          <span><b>{t("recNone")}</b> <span className="text-xs text-muted">{t("recNoneHint")}</span></span>
        )}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="ev-table min-w-[820px]">
          <thead>
            <tr>
              <th />
              <th>{solo ? t("unitModel") : t("unitCombo")}</th>
              <th className="r">{t("colPass")}</th>
              {AXES.map((a) => (
                <th key={a} className={`r ev-sort ${a === axis ? "on" : ""}`} onClick={() => setAxis(a)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setAxis(a)}>
                  {t(`axis.${a}`)}
                </th>
              ))}
              <th>{t("colVerdict")}</th>
              <th className="r">{t("colReport")}</th>
            </tr>
          </thead>
          <tbody ref={body}>
            {order.map((r, i) => {
              const bad = i >= ok.length;
              return [
                <tr key={r.id} data-id={r.id} className={bad ? "ev-out" : i === 0 ? "ev-top" : ""}>
                  <td className="w-8 text-center font-extrabold text-muted">{bad ? "✕" : i + 1}</td>
                  <td><ComboBadge thinking={r.thinking} execution={r.execution} solo={solo} labels={labels} tags={tags} /></td>
                  <td className="r tabular-nums">{r.qualified}/{r.observations}</td>
                  {AXES.map((a) => (
                    <td key={a} className={`r tabular-nums ${a === axis ? "font-bold" : ""}`}>
                      {show(r, a)}
                      <div className="text-xs text-muted">
                        {a === "speed" && r.eligible && r.p90Seconds !== null ? t("p90", { t: fmtTime(r.p90Seconds) }) : a === "quality" ? `${r.meanScore.toFixed(1)} ± ${r.stdErr.toFixed(1)}` : a === "creativity" && r.creativityTotal ? t("wins", { w: r.creativityWins ?? 0, n: r.creativityTotal }) : ""}
                      </div>
                    </td>
                  ))}
                  <td><VerdictChip v={r.verdict} label={t(`verdict.${r.verdict}`)} /></td>
                  <td className="r"><Link className="text-accent" href={`/benchmarks/evals/${r.id}`}>#{r.id}</Link></td>
                </tr>,
                bad ? (
                  <tr key={`w${r.id}`} className="ev-out">
                    <td />
                    <td colSpan={9} className="ev-why">{t("notMatch", { why: why(r).join("、") })}</td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type MxCell = { id: number; thinking: string; execution: string; values: Record<Axis, number | null>; eligible: boolean; trial: boolean; out: boolean; single: number | null; current?: boolean };

/** Thinking × execution matrix (skill evaluations): each cell a combination, coloured by the chosen axis */
export function ComboMatrix({ cells, labels }: { cells: MxCell[]; labels: Record<string, string> }) {
  const t = useTranslations("evals");
  const [axis, setAxis] = useState<Axis>("quality");
  const TH = [...new Set(cells.map((c) => c.thinking))];
  const EX = [...new Set(cells.map((c) => c.execution))];
  const vals = cells.filter((c) => c.eligible).map((c) => c.values[axis]).filter((v): v is number => v !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const good = (c: MxCell) => {
    const v = c.values[axis];
    if (!c.eligible || v === null) return null;
    const x = hi === lo ? 1 : (v - lo) / (hi - lo);
    return LOW[axis] ? 1 - x : x;
  };
  const fmt = (c: MxCell) => {
    const v = c.values[axis];
    if (v === null) return "—";
    return axis === "speed" ? fmtTime(v) : axis === "cost" ? fmtUsd(v) : axis === "quality" ? v.toFixed(1) : pct(v);
  };
  const name = (m: string) => labels[m] ?? labels[m.replace(/^[^/]+\//, "")] ?? m.replace(/^[^/]+\//, "");
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {AXES.map((a) => (
            <button key={a} type="button" onClick={() => setAxis(a)} className={`px-3 py-1 text-sm ${a === axis ? "bg-accent font-semibold text-accent-ink" : "bg-panel"}`}>
              {t(`axis.${a}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="ev-mx">
          <thead>
            <tr><th /><th colSpan={EX.length} style={{ color: "var(--ex)" }}>{t("execution")} →</th></tr>
            <tr><th className="rh" style={{ color: "var(--th)" }}>{t("thinking")} ↓</th>{EX.map((e) => <th key={e}>{name(e)}</th>)}</tr>
          </thead>
          <tbody>
            {TH.map((th) => (
              <tr key={th}>
                <th className="rh">{name(th)}</th>
                {EX.map((ex) => {
                  const c = cells.find((x) => x.thinking === th && x.execution === ex);
                  if (!c) return <td key={ex}><div className="empty"><small>{t("untested")}</small></div></td>;
                  const g = good(c);
                  return (
                    <td key={ex}>
                      <Link href={`/benchmarks/evals/${c.id}`} title={`${th} + ${ex}`} style={{ background: g === null ? "transparent" : `color-mix(in srgb, var(--accent) ${Math.round(10 + g * 55)}%, var(--panel))`, outline: c.current ? "2px solid var(--ink)" : undefined, outlineOffset: 1 }}>
                        <b>{c.eligible ? fmt(c) : c.trial ? (c.single?.toFixed(1) ?? "—") : "—"}</b>
                        <small>{c.trial ? t("trialShort") : c.out ? t("outShort") : `#${c.id}`}</small>
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type QRow = { i: number; label: string; category: string; kind: "det" | "judge"; critical: boolean; owner: "skill" | "thinking" | "execution"; oks: boolean[]; evidence: string };
export type QTask = { id: string; title: string; cats: { name: string; weight: number; rate: number }[]; rows: QRow[] };

/** The yes/no questions × trials (A), with the evidence and who lost the point */
export function QuestionTable({ tasks, n }: { tasks: QTask[]; n: number }) {
  const t = useTranslations("evals");
  const [only, setOnly] = useState(false);
  const many = tasks.length > 1;
  const list = useMemo(() => Array.from({ length: n }, (_, i) => i + 1).join(" "), [n]);
  return (
    <div>
      <label className="mb-2 flex items-center justify-end gap-2 text-xs text-muted">
        <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> {t("onlyFail")}
      </label>
      {tasks.map((task) => (
        <div key={task.id}>
          {many && <h3 className="mt-4 font-semibold">{task.title}</h3>}
          <div className="text-right text-xs text-muted">{t("trialCols", { list })}</div>
          {task.cats.map((c) => {
            const rows = task.rows.filter((r) => r.category === c.name && (!only || r.oks.some((o) => !o)));
            if (!rows.length) return null;
            return (
              <div key={c.name}>
                <h4 className="mt-3 text-sm font-semibold">
                  {c.name} <span className="text-xs font-normal text-muted">{t("weight", { w: c.weight })} · {t("avgRate", { n, p: pct(c.rate) })}</span>
                </h4>
                <table className="ev-table">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.i} id={`q-${task.id}-${r.i}`}>
                        <td className="w-7 text-center text-muted tabular-nums">{r.i}</td>
                        <td>
                          {r.label}
                          <div className="text-xs text-muted">
                            <span className={`ev-chip ${r.kind === "det" ? "ev-det" : "ev-judge"}`}>{t(`kind.${r.kind}`)}</span>
                            {r.critical && <span className="ev-chip ev-crit">{t("critical")}</span>}
                            {r.evidence && <>{t("evidenceLabel")}{r.evidence}</>}
                          </div>
                        </td>
                        <td className="w-24 whitespace-nowrap text-center">
                          {r.oks.map((o, k) => <span key={k} className={o ? "ev-yes" : "ev-no"}>{o ? t("yes") : t("no")} </span>)}
                        </td>
                        <td className="w-28 text-right text-xs">
                          {r.oks.some((o) => !o) && <span className="ev-chip" style={{ color: r.owner === "thinking" ? "var(--th)" : r.owner === "execution" ? "var(--ex)" : "var(--warn)" }}>{t("lost", { o: t(`owner.${r.owner}`) })}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function CopyLink({ url }: { url: string }) {
  const t = useTranslations("evals");
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn-ghost !px-3 !py-1.5" onClick={() => navigator.clipboard.writeText(url).then(() => (setOk(true), setTimeout(() => setOk(false), 1500)))}>
      {ok ? t("copied") : t("copyLink")}
    </button>
  );
}

/** The publisher of a report makes it public or private */
export function VisibilityToggle({ id, visibility }: { id: number; visibility: string }) {
  const t = useTranslations("evals");
  const [v, setV] = useState(visibility);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const flip = async () => {
    setBusy(true);
    setErr("");
    const to = v === "public" ? "private" : "public";
    const r = await fetch(`/api/v1/evals/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: to }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error || `HTTP ${r.status}`);
    setV(j.visibility);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className={`ev-chip ${v === "public" ? "ev-ok" : "ev-mid"}`}>{v === "public" ? t("visPublic") : t("visPrivate")}</span>
      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={busy} onClick={flip}>{v === "public" ? t("makePrivate") : t("makePublic")}</button>
      {err && <span className="text-err">{err}</span>}
    </span>
  );
}
