/** Landing section "open the black box": a usual agent's log next to a SinoBee answer bubble. */
import type React from "react";
import { InView } from "@/components/in-view";

export type BlackBoxText = {
  eyebrow: string; title1: string; title2: string; lead: string; art: string;
  other: { label: string; more: string; answer: string; verdict: string };
  ours: {
    label: string; done: string; meta: string; answer: string; key: string; process: string; counts: string;
    think: string; work: string; check: string; verdict: string;
    items: { q: string; a: string }[];
  };
  points: { title: string; body: string }[];
};

/** commands of the kind an agent runs; shown as-is, not translated */
const LOG = [
  "shell  cd ~/project && python3 - <<EOF …",
  "shell  sed -n '268,282p' /tmp/game.js",
  'shell  grep -n "else if (c.grounded)" index.html',
  "edit_file  index.html (1 replacement)",
  "shell  node run_full.js",
  "shell  node run_stop_outside2.js",
  "shell  ls -la dist/ && du -sh *",
  "shell  node probe_grip.js --samples 7",
];

const STROKE = { fill: "none", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** a sheet of paper centred on cx,cy with a glyph on it */
function Paper({ cx, cy, r, band, children }: { cx: number; cy: number; r: number; band?: string; children: React.ReactNode }) {
  return (
    <g transform={`translate(${cx} ${cy}) rotate(${r})`}>
      <rect x="-17" y="-21" width="34" height="42" rx="4" fill="var(--panel)" stroke="var(--line)" strokeWidth="1.5" />
      {band && <path d="M-17-17a4 4 0 0 1 4-4h26a4 4 0 0 1 4 4v6h-34z" fill={band} />}
      <g {...STROKE} strokeWidth="2">{children}</g>
    </g>
  );
}

/** what pops out of the box, one scene per opening: files, a question, an idea */
const SCENES = [
  <g key="files">
    <Paper cx={104} cy={70} r={-14} band="var(--err)"><path d="M-9-2h18M-9 5h12M-9 12h15" stroke="var(--muted)" /></Paper>
    <Paper cx={176} cy={70} r={14}><path d="M-9 13v-7M-3 13v-14M3 13v-10M9 13v-18" stroke="var(--accent)" /></Paper>
    <Paper cx={140} cy={56} r={0}><rect x="-10" y="-12" width="20" height="24" stroke="var(--ok)" /><path d="M-10-4h20M-10 4h20M-3-12v24M4-12v24" stroke="var(--ok)" /></Paper>
  </g>,
  <g key="question">
    <path d="M108 30h64a14 14 0 0 1 14 14v30a14 14 0 0 1-14 14h-26l-14 14v-14h-24a14 14 0 0 1-14-14V44a14 14 0 0 1 14-14z" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2.5" />
    <path d="M128 50a12 12 0 1 1 15.5 11.5c-2.3.8-3.5 2.6-3.5 5V69M140 78v.4" {...STROKE} stroke="var(--accent)" strokeWidth="5" />
  </g>,
  <g key="idea">
    <path d="M140 22a32 32 0 0 0-19 57.7c3.6 2.8 5 6.3 5 10.3h28c0-4 1.4-7.5 5-10.3A32 32 0 0 0 140 22z" fill="#f2c14e" />
    <circle cx="140" cy="52" r="12" fill="none" stroke="#fff" strokeWidth="6" strokeDasharray="4.2 2.1" />
    <circle cx="140" cy="52" r="7.5" fill="#fff" />
    <path d="M129 52c3.5-5 7.5 5 11 0s7.5 5 11 0M133 56l2 30M147 56l-2 30" {...STROKE} stroke="#0b1528" strokeWidth="2" />
    <path d="M127 94h26M129 101h22" {...STROKE} stroke="#5b6b80" strokeWidth="5" />
  </g>,
];

/** a black box: flaps open, something pops out (files, a question or an idea), goes back in, flaps close; repeats */
function BoxArt({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 280 210" className="h-auto w-full max-w-[280px]" role="img" aria-label={label}>
      <g fill="var(--panel-2)">
        <rect x="40" y="34" width="190" height="40" rx="20" />
        <rect x="8" y="78" width="232" height="44" rx="22" />
        <rect x="20" y="148" width="250" height="40" rx="20" />
      </g>
      <g className="bb-rays" {...STROKE} strokeWidth="3">
        <path d="M140 2v10M100 14l7 8M180 14l-7 8M82 56h11M187 56h11" stroke="var(--ink)" />
        <path d="M62 34c8-8 14 4 6 8" stroke="var(--muted)" strokeWidth="2" />
        <path d="M214 76c-6 8 6 10 2 18" stroke="#f2c14e" strokeWidth="2" />
        <path d="M196 20l6-4 1 7z" fill="var(--accent)" stroke="var(--accent)" strokeWidth="1.5" />
        <path d="M66 96l9-2" stroke="#f2c14e" strokeWidth="4" />
        <path d="M206 108l7-5" stroke="var(--err)" strokeWidth="4" />
        <circle cx="72" cy="114" r="4" stroke="var(--muted)" strokeWidth="1.8" />
        <circle cx="222" cy="52" r="3.5" stroke="var(--muted)" strokeWidth="1.8" />
      </g>
      <rect x="82" y="113" width="116" height="9" fill="#050a14" />
      {SCENES.map((sc, i) => <g key={i} className="bb-scene" style={{ animationDelay: `${i * 4}s` }}>{sc}</g>)}
      <path d="M80 120h72v74H80z" fill="#0b1528" />
      <path d="M152 120h48v74h-48z" fill="#16233a" />
      <path d="M80 120h120v74H80z" fill="none" stroke="var(--muted)" strokeOpacity=".45" />
      <rect className="bb-flap-l" x="80" y="114" width="60" height="7" rx="2" fill="#24364f" stroke="var(--muted)" strokeOpacity=".45" />
      <rect className="bb-flap-r" x="140" y="114" width="60" height="7" rx="2" fill="#1c2c45" stroke="var(--muted)" strokeOpacity=".45" />
    </svg>
  );
}

const ICON = {
  ask: <><path d="M4 5h16v11H9l-5 4z" /><path d="M10 9.3a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.4" /><path d="M12 14.2v.1" /></>,
  trace: <><path d="M4 6h9M4 11h6M4 16h5" /><circle cx="16" cy="14" r="3.2" /><path d="M18.3 16.3 21 19" /></>,
  rule: <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
};

function Tag({ label, tone }: { label: string; tone: "accent" | "muted" | "err" }) {
  const c = tone === "accent" ? "border-accent text-accent" : tone === "err" ? "border-err text-err" : "border-line text-muted";
  return <span className={`mt-0.5 shrink-0 self-start whitespace-nowrap rounded-full border px-2 text-[11px] leading-5 ${c}`}>{label}</span>;
}

export function BlackBox({ t }: { t: BlackBoxText }) {
  const tags = [
    { label: t.ours.think, tone: "accent" as const },
    { label: t.ours.work, tone: "muted" as const },
    { label: `✕ ${t.ours.check}`, tone: "err" as const },
  ];
  return (
    <InView className="container-x py-12">
      <section>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="chip border-accent/40 text-accent">{t.eyebrow}</span>
            <h2 className="h2 mt-4 !text-3xl">
              {t.title1}
              <span className="text-accent">{t.title2}</span>
            </h2>
            <p className="mt-2 max-w-xl text-muted">{t.lead}</p>
          </div>
          <div className="w-44 flex-none self-center sm:w-56"><BoxArt label={t.art} /></div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="text-sm font-semibold text-muted">{t.other.label}</div>
            <div className="relative flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-[#0b1528] p-6">
              <div className="relative h-[180px] overflow-hidden [mask-image:linear-gradient(transparent,#000_20%,#000_70%,transparent)]" aria-hidden>
                <div className="bb-log flex flex-col gap-2.5 font-mono text-[13px] text-[#6f8590]">
                  {[...LOG, ...LOG].map((l, i) => <div key={i} className="truncate">▸ {l}</div>)}
                </div>
              </div>
              <svg viewBox="0 0 56 56" className="pointer-events-none absolute left-1/2 top-[38%] h-14 w-14 -translate-x-1/2 -translate-y-1/2" aria-hidden>
                <g className="bb-q">
                  <circle cx="28" cy="28" r="26" fill="#16233a" stroke="#2b405c" strokeWidth="2" />
                  <path d="M21.5 22a6.5 6.5 0 1 1 8.6 6.2c-1.3.5-2.1 1.5-2.1 2.9V33M28 39.5v.2" fill="none" stroke="#8aa1ad" strokeWidth="3.2" strokeLinecap="round" />
                </g>
              </svg>
              <div className="text-[12px] text-[#4a5d6c]">{t.other.more}</div>
              <div className="flex-1" />
              <div className="mt-4 rounded-xl bg-[#16233a] px-4 py-3.5 text-[15px] text-[#e3f3ec]">{t.other.answer}</div>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted"><span className="text-err">✕</span>{t.other.verdict}</p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="text-sm font-semibold text-accent">{t.ours.label}</div>
            <div className="card flex min-h-[320px] flex-1 flex-col gap-2.5 px-6 py-5 text-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2.5 text-xs text-muted">
                <b className="text-ok">✓ {t.ours.done}</b><span>{t.ours.meta}</span>
              </div>
              <div className="leading-relaxed">{t.ours.answer}</div>
              <div className="flex items-center gap-2 text-xs text-muted">
                {t.ours.key}<span className="rounded-lg border border-accent px-2.5 py-0.5 text-accent">index.html</span>
              </div>
              <div className="border-t border-line pt-2 font-semibold">
                ▾ {t.ours.process} <span className="ml-1 text-xs font-normal text-muted">{t.ours.counts}</span>
              </div>
              {t.ours.items.map((it, i) => (
                <div key={i} className={`bb-in bb-d${i + 1} flex items-start gap-2.5`}>
                  <Tag {...tags[i]} />
                  <div className="min-w-0">
                    <div className="break-words">{it.q}</div>
                    <div className="mt-0.5 break-words text-xs text-muted">{it.a}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="flex items-center gap-2 text-sm text-muted"><span className="text-ok">✓</span>{t.ours.verdict}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-5 border-t border-line pt-6 sm:grid-cols-3">
          {t.points.map((p, i) => (
            <div key={p.title} className="flex items-center gap-3">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {[ICON.ask, ICON.trace, ICON.rule][i]}
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="font-bold">{p.title}</h3>
                <p className="text-sm text-muted">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </InView>
  );
}
