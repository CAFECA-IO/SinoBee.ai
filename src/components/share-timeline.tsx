import type { ShareTimeline, ShareTimelineItem } from "@/lib/shares/service";

type Labels = {
  process: string; think: string; work: string; check: string; steer: string; decision: string; answer: string;
  result: string; key: string; tools: string; steps: string; noAnswer: string; yourNote: string;
};

const SRC_CLASS: Record<string, string> = { "思維模型": "text-accent", "你": "text-warn" };

function Tag({ label, tone }: { label: string; tone?: "accent" | "warn" | "ok" | "err" }) {
  const c = tone === "accent" ? "border-accent text-accent" : tone === "warn" ? "border-warn text-warn"
    : tone === "ok" ? "border-ok text-ok" : tone === "err" ? "border-err text-err" : "border-line text-muted";
  return <span className={`mt-0.5 inline-block min-w-10 shrink-0 self-start whitespace-nowrap rounded-full border px-2 text-center text-[11px] leading-5 ${c}`}>{label}</span>;
}

function Source({ s }: { s?: string }) {
  return s ? <span className={`ml-1 whitespace-nowrap rounded border border-line px-1 text-[10px] ${SRC_CLASS[s] ?? "text-muted"}`}>{s}</span> : null;
}

function Item({ it, l }: { it: ShareTimelineItem; l: Labels }) {
  if (it.kind === "think") {
    const you = it.source === "你";
    return (
      <div className="flex items-start gap-3 py-1.5">
        <Tag label={you ? l.decision : l.think} tone={you ? "warn" : "accent"} />
        <div className="min-w-0">
          <div className="break-words">{it.q}</div>
          <div className="mt-0.5 break-words text-xs text-muted">{it.a ? <>{l.answer}{it.a}</> : l.noAnswer}<Source s={it.source} /></div>
        </div>
      </div>
    );
  }
  if (it.kind === "work") {
    const bad = it.status === "err";
    const steps = [it.title, ...(it.notes ?? [])].filter(Boolean) as string[];
    return (
      <div className="flex items-start gap-3 py-1.5">
        <Tag label={l.work} tone={bad ? "err" : undefined} />
        <div className="min-w-0 flex-1">
          <div className="break-words">{it.title}</div>
          {(it.result || (it.files ?? []).length > 0) && (
            <div className={`mt-0.5 break-words text-xs ${bad ? "text-err" : "text-muted"}`}>
              {it.result && <>{bad ? "" : l.result}{it.result}</>}{(it.files ?? []).length > 0 && <> · {it.files!.join("、")}</>}
            </div>
          )}
          {(it.tools ?? []).length > 0 && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-accent">{steps.length > 1 ? `${l.steps.replace("{n}", String(steps.length))}、` : ""}{l.tools.replace("{n}", String(it.tools!.length))}</summary>
              {steps.length > 1 && <ol className="ml-5 mt-1 list-decimal text-muted">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted">
                {it.tools!.map((t, i) => <li key={i} className="break-all"><b className="text-ink">{t.name}</b> {t.brief}</li>)}
              </ul>
            </details>
          )}
        </div>
      </div>
    );
  }
  if (it.kind === "check") {
    const tone = it.ok === false ? "err" : it.ok === true ? "ok" : undefined;
    return (
      <div className="flex items-start gap-3 py-1.5">
        <Tag label={`${it.ok === false ? "✕" : it.ok === true ? "✓" : "·"} ${l.check}`} tone={tone} />
        <div className="min-w-0">
          <div className="break-words">{it.title}</div>
          {it.result && <div className="mt-0.5 break-words text-xs text-muted">{it.result}<Source s={it.source} /></div>}
        </div>
      </div>
    );
  }
  if (it.kind === "steer") {
    return (
      <div className="flex items-start gap-3 py-1.5">
        <Tag label={l.steer} tone="warn" />
        <div className="min-w-0"><div className="break-words">{it.text}</div><div className="mt-0.5 text-xs text-muted">{l.yourNote}</div></div>
      </div>
    );
  }
  return null;
}

/** A large turn as SinoBee showed it: key files under the answer, then the process folded. */
export function ShareTimelineView({ tl, l, fileHref }: { tl: ShareTimeline; l: Labels; fileHref: (name: string) => string | null }) {
  const counts = { think: 0, work: 0, check: 0 } as Record<string, number>;
  for (const it of tl.items) if (it.kind in counts) counts[it.kind] += 1;
  // items grouped under their milestone, in order
  const groups: { phase: ShareTimelineItem | null; items: ShareTimelineItem[] }[] = [];
  const byPhase = new Map<string, { phase: ShareTimelineItem | null; items: ShareTimelineItem[] }>();
  for (const it of tl.items) {
    if (it.kind === "phase") {
      const g = { phase: it, items: [] as ShareTimelineItem[] };
      byPhase.set(it.id ?? "", g); groups.push(g); continue;
    }
    const g = (it.phase && byPhase.get(it.phase)) || (groups.length && !groups[groups.length - 1].phase ? groups[groups.length - 1] : null);
    if (g) g.items.push(it);
    else groups.push({ phase: null, items: [it] });
  }
  return (
    <div className="mt-3 space-y-3 text-sm">
      {tl.key.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{l.key}</span>
          {tl.key.map((k) => { const h = fileHref(k); return h
            ? <a key={k} href={h} className="rounded-lg border border-accent px-2.5 py-1 text-xs text-accent hover:bg-accent-soft">{k}</a>
            : <span key={k} className="rounded-lg border border-line px-2.5 py-1 text-xs">{k}</span>; })}
        </div>
      )}
      <details className="border-t border-line pt-2">
        <summary className="cursor-pointer select-none font-semibold">
          {l.process} <span className="ml-1 text-xs font-normal text-muted">
            {[counts.think && `${l.think} ${counts.think}`, counts.work && `${l.work} ${counts.work}`, counts.check && `${l.check} ${counts.check}`].filter(Boolean).join(" · ")}
          </span>
        </summary>
        <div className="ml-1.5 mt-2 border-l-2 border-line pl-3">
          {groups.map((g, i) => (
            <div key={i} className={g.phase ? "py-1" : ""}>
              {g.phase && (
                <div className="py-1 font-semibold">
                  <span className={g.phase.status === "done" ? "text-ok" : g.phase.status === "failed" ? "text-err" : "text-muted"}>{g.phase.status === "done" ? "✓" : g.phase.status === "failed" ? "!" : "·"}</span> {g.phase.title}
                  {g.phase.summary && <span className="ml-1 text-xs font-normal text-muted">— {g.phase.summary}</span>}
                </div>
              )}
              <div className={g.phase ? "pl-3" : ""}>{g.items.map((it, j) => <Item key={j} it={it} l={l} />)}</div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
