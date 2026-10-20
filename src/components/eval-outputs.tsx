"use client";

/**
 * 成果: every trial's outputs next to its verdicts (design draft 2026-10-21, R2). An HTML output runs in
 * <iframe sandbox="allow-scripts" srcdoc> (an opaque origin: no cookies, no storage, no network - its CSP - no
 * popups, no navigation of this page), only after the reader asks for it. Clicking a question marks the judge's
 * quote: in the page (postMessage to the finder the page carries), else in the source by its position.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/components/markdown";

type Grade = { ok: boolean; detail?: string; evidence?: string | null; votes?: unknown; where?: { file: string; start: number; end: number } | null };
type Out = { path: string; kind?: string; bytes?: number; sha256?: string | null; uploaded?: boolean | null; missing?: boolean | null; text?: string | null };
type Trial = { trial: number; run_trial?: number | null; q: number; qualified: boolean; status?: string | null; error?: string | null; answer?: string; grades: Grade[]; outputs?: Out[] };
type Q = { label: string; category: string; kind: "det" | "judge"; critical?: boolean };
export type OutTask = { id: string; title: string; prompt: string; questions: Q[]; trials: Trial[] };

const ext = (p: string) => (p.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "").toLowerCase();
const kindOf = (p: string) => {
  const e = ext(p);
  if (e === ".html" || e === ".htm") return "html";
  if (e === ".svg") return "svg";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(e)) return "image";
  if (e === ".md") return "markdown";
  if (e === ".csv") return "csv";
  return "text";
};
const ORDER = ["html", "markdown", "image", "svg", "csv", "text"];
const fmtBytes = (n = 0) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`);

export function EvalOutputs({ reportId, tasks, judge, note }: { reportId: number; tasks: OutTask[]; judge: string; note?: string }) {
  const t = useTranslations("evals.out");
  const nTrials = Math.max(0, ...tasks.map((x) => x.trials.length));
  // open the floor: the lowest-scoring qualified trial over the suite (else the lowest), not the best one
  const firstTrial = useMemo(() => {
    const per = Array.from({ length: nTrials }, (_, i) => ({ i, q: tasks.reduce((a, x) => a + (x.trials[i]?.q ?? 0), 0) / (tasks.length || 1), ok: tasks.every((x) => x.trials[i]?.qualified) }));
    const pool = per.some((x) => x.ok) ? per.filter((x) => x.ok) : per;
    return pool.reduce((a, x) => (x.q < a.q ? x : a), pool[0] ?? { i: 0, q: 0, ok: false }).i;
  }, [tasks, nTrials]);
  const [ti, setTi] = useState(0);
  const [tr, setTr] = useState(firstTrial);
  const [file, setFile] = useState<string | null>(null);
  const [tab, setTab] = useState<"view" | "src" | "files">("view");
  const [qi, setQi] = useState<number | null>(null);
  const [run, setRun] = useState(false);
  const [phone, setPhone] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const task = tasks[ti];
  const trial = task?.trials[tr];
  const outs = (trial?.outputs ?? []).map((o) => ({ ...o, k: kindOf(o.path) }));
  const main = [...outs].filter((o) => o.uploaded && !o.missing).sort((a, b) => ORDER.indexOf(a.k) - ORDER.indexOf(b.k))[0];
  const cur = outs.find((o) => o.path === file) ?? main ?? null;
  const grade = qi != null ? trial?.grades[qi] : null;
  const q = (p: string) => `/api/v1/evals/${reportId}/outputs?${p}`;
  const fileUrl = (o: Out, dl = false) => q(`sha=${o.sha256}&path=${encodeURIComponent(o.path)}${dl ? "&download=1" : ""}`);
  const viewable = cur && cur.uploaded && ["html", "markdown", "image", "svg", "csv"].includes(cur.k);
  const shownTab = tab === "view" && !viewable ? (cur?.uploaded ? "src" : "files") : tab;

  useEffect(() => { setHtml(null); setText(null); setNotFound(false); }, [ti, tr, cur?.path]);
  useEffect(() => {          // the page, once the reader asked to run it
    if (!cur || cur.k !== "html" || shownTab !== "view" || !run || html) return;
    let live = true;
    fetch(q(`page=1&task=${encodeURIComponent(task.id)}&trial=${trial.trial}&path=${encodeURIComponent(cur.path)}`))
      .then((r) => r.json()).then((j) => { if (live) setHtml(j.html ?? ""); }).catch(() => live && setHtml(""));
    return () => { live = false; };
  }, [cur, shownTab, run, html, task, trial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {          // text for the source, a document or a table
    if (!cur || !cur.uploaded || text != null || (shownTab === "view" && ["html", "image", "svg"].includes(cur.k)) || shownTab === "files") return;
    let live = true;
    fetch(fileUrl(cur)).then((r) => r.text()).then((s) => live && setText(s)).catch(() => live && setText(""));
    return () => { live = false; };
  }, [cur, shownTab, text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {          // mark the judge's quote in the running page
    const f = frame.current;
    if (!f || !grade?.evidence) return;
    const send = () => f.contentWindow?.postMessage({ sinobeeFind: grade.evidence }, "*");
    send();
    f.addEventListener("load", send);
    return () => f.removeEventListener("load", send);
  }, [grade, html]);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && typeof e.data?.sinobeeFound === "boolean") setNotFound(!e.data.sinobeeFound); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  useEffect(() => { document.getElementById("evo-mark")?.scrollIntoView({ block: "center" }); }, [text, qi, shownTab]);

  if (!task || !trial) return null;
  const anyUploaded = tasks.some((x) => x.trials.some((y) => (y.outputs ?? []).some((o) => o.uploaded)));
  const pick = (i: number) => {
    const g = trial.grades[i];
    const next = qi === i ? null : i;
    setQi(next);
    setNotFound(false);
    if (next != null && g?.where && g.where.file !== cur?.path) setFile(g.where.file);
    const target = outs.find((o) => o.path === (g?.where?.file ?? cur?.path));
    if (next != null && g?.where && target && !["html", "markdown"].includes(target.k)) setTab("src");
  };
  const src = text ?? "";
  const w = grade?.where && cur && grade.where.file === cur.path ? grade.where : null;

  return (
    <section className="card p-5" id="outputs">
      <h2 className="h3">{t("title")} <span className="text-xs font-normal text-muted">{t("sub")}</span></h2>
      {!anyUploaded && <p className="mt-2 text-sm text-muted">{t("none")}</p>}
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      <div className="evo-tabs mt-3">
        {tasks.map((x, i) => (
          <button key={x.id} type="button" className={i === ti ? "on" : ""} title={x.prompt.slice(0, 300)} onClick={() => { setTi(i); setFile(null); setQi(null); setTab("view"); }}>
            {t("input", { n: i + 1 })} · {x.title}
          </button>
        ))}
        <span className="evo-trials">
          {task.trials.map((y, i) => (
            <button key={y.trial} type="button" className={`${i === tr ? "on" : ""} ${y.qualified ? "ok" : "bad"}`} onClick={() => { setTr(i); setFile(null); setQi(null); }}>
              {t("trial", { n: y.trial })} · {Math.round(y.q)} {y.qualified ? t("pass") : t("fail")}
            </button>
          ))}
        </span>
      </div>
      <details className="mt-2 text-xs text-muted"><summary>{t("prompt")}</summary><pre className="ev-pre mt-1">{task.prompt}</pre></details>
      <div className="evo-b mt-3">
        <div className="evo-v">
          <div className="evo-vt">
            {viewable && <button type="button" className={shownTab === "view" ? "on" : ""} onClick={() => setTab("view")}>{t("view")}</button>}
            {cur?.uploaded && cur.k !== "image" && <button type="button" className={shownTab === "src" ? "on" : ""} onClick={() => setTab("src")}>{t("source")}</button>}
            <button type="button" className={shownTab === "files" ? "on" : ""} onClick={() => setTab("files")}>{t("files", { n: outs.length })}</button>
            {cur?.k === "html" && shownTab === "view" && run && (
              <>
                <span className="sp" />
                <button type="button" className={!phone ? "on" : ""} onClick={() => setPhone(false)}>{t("desktop")}</button>
                <button type="button" className={phone ? "on" : ""} onClick={() => setPhone(true)}>{t("phone")}</button>
                <button type="button" onClick={() => frame.current?.requestFullscreen?.()}>{t("full")}</button>
              </>
            )}
          </div>
          <div className="evo-stage">
            {shownTab === "files" ? (
              <table className="ev-table text-xs">
                <thead><tr><th>{t("file")}</th><th className="r">{t("size")}</th><th>sha256</th></tr></thead>
                <tbody>
                  {outs.map((o) => (
                    <tr key={o.path}>
                      <td>{o.uploaded ? <button type="button" className="link" onClick={() => { setFile(o.path); setTab("view"); }}>{o.path}</button> : <>{o.path} <span className="text-muted">({t("notUploaded")})</span></>}</td>
                      <td className="r tabular-nums">{fmtBytes(o.bytes)}</td>
                      <td><code>{(o.sha256 ?? "").slice(0, 16)}</code></td>
                    </tr>
                  ))}
                  {!outs.length && <tr><td colSpan={3}>{t("noFiles")}</td></tr>}
                </tbody>
              </table>
            ) : !cur ? (
              <div className="evo-empty">{t("noFiles")}</div>
            ) : !cur.uploaded ? (
              <div className="evo-empty">{t("notUploadedLong")}</div>
            ) : shownTab === "view" && cur.k === "html" ? (
              !run ? (
                <div className="evo-gate">
                  <b>{t("gateTitle")}</b>
                  <span>{t("gateBody")}</span>
                  {/inject|注入/i.test(task.id + task.title) && <b className="text-warn">{t("gateInject")}</b>}
                  <button type="button" className="btn btn-primary" onClick={() => setRun(true)}>{t("run")}</button>
                </div>
              ) : html == null ? <div className="evo-empty">{t("loading")}</div>
                : <iframe ref={frame} title={cur.path} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={html} className={`evo-frame${phone ? " phone" : ""}`} />
            ) : shownTab === "view" && (cur.k === "image" || cur.k === "svg") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <div className="evo-img"><img src={fileUrl(cur)} alt={cur.path} /></div>
            ) : shownTab === "view" && cur.k === "markdown" ? (
              <div className="evo-doc"><Markdown>{src.replace(/!\[[^\]]*\]\((?!https?:|data:)[^)]*\)/g, "")}</Markdown></div>
            ) : shownTab === "view" && cur.k === "csv" ? (
              <div className="evo-doc"><table className="ev-table text-xs"><tbody>{src.split(/\r?\n/).filter(Boolean).slice(0, 500).map((l, i) => <tr key={i}>{l.split(",").map((c, j) => (i ? <td key={j}>{c}</td> : <th key={j}>{c}</th>))}</tr>)}</tbody></table></div>
            ) : (
              <pre className="evo-src">{w ? <>{src.slice(0, w.start)}<mark id="evo-mark">{src.slice(w.start, w.end)}</mark>{src.slice(w.end)}</> : src}</pre>
            )}
          </div>
          <div className="evo-foot">
            {cur ? (
              <>
                {cur.path} · {fmtBytes(cur.bytes)}{cur.sha256 && <> · <span title={`sha256 ${cur.sha256}`}>{t("hash", { h: cur.sha256.slice(0, 10) })}</span></>}
                {cur.uploaded && <> · <a href={fileUrl(cur, true)}>{t("download")}</a></>}
                {notFound && grade && <> · <span className="text-warn">{t("notOnPage")}</span></>}
              </>
            ) : null}
            {trial.status && trial.status !== "done" && <> · <b className="text-warn">{trial.status}{trial.error ? `: ${trial.error.slice(0, 120)}` : ""}</b></>}
          </div>
        </div>
        <div className="evo-q">
          <div className="evo-qh"><b>{t("grading", { n: trial.trial, i: ti + 1 })}</b><span>{Math.round(trial.q)} · {trial.qualified ? t("pass") : t("fail")}</span></div>
          <ol>
            {trial.grades.map((g, i) => {
              const qq = task.questions[i];
              return (
                <li key={i} className={`${g.ok ? "y" : "n"} ${qi === i ? "on" : ""}`} tabIndex={0} onClick={() => pick(i)} onKeyDown={(e) => e.key === "Enter" && pick(i)}>
                  <span className="mk">{g.ok ? "✓" : "✗"}</span>
                  <span>
                    <b>{qq?.label ?? `#${i + 1}`}</b>{qq?.critical && <span className="ev-chip warn ml-1">{t("critical")}</span>}
                    <small>{qq?.category}{qq ? ` · ${qq.kind === "judge" ? t("byJudge", { m: judge }) : t("byCheck")}` : ""}</small>
                    {qi === i && (
                      <div className="evo-ev">
                        {g.evidence && <><div className="k">{t("evidence")}{!g.where && (cur?.k !== "html" || notFound) && <span className="text-warn"> · {t("evidenceMissing")}</span>}</div><blockquote>{g.evidence}</blockquote></>}
                        {g.detail && <><div className="k">{t("detail")}</div><div>{g.detail}</div></>}
                      </div>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {trial.answer && <details className="mt-2 text-xs"><summary>{t("answer")}</summary><div className="mt-1"><Markdown>{trial.answer}</Markdown></div></details>}
        </div>
      </div>
    </section>
  );
}
