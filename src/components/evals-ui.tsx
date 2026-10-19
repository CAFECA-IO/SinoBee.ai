/** Shared pieces of the evaluation pages (/benchmarks/evals); usable from server and client components. */

export const fmtTime = (s: number | null | undefined) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const r = Math.round(s);
  return r >= 3600 ? `${Math.floor(r / 3600)}:${String(Math.floor((r % 3600) / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}` : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
};
export const fmtUsd = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `$${v.toFixed(2)}`);
export const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** a model id shown short: "gemini/gemini-pro-latest" → its catalog label, else "gemini-pro-latest" */
export function modelName(labels: Record<string, string>, m: string) {
  return labels[m] ?? labels[m.replace(/^[^/]+\//, "")] ?? m.replace(/^[^/]+\//, "");
}

/**
 * The thing under test, always shown as one unit: a skill evaluation's combination (thinking | execution), or a
 * model evaluation's single model.
 */
export function ComboBadge({ thinking, execution, solo, labels, tags }: { thinking: string; execution: string; solo: boolean; labels: Record<string, string>; tags: { th: string; ex: string; solo: string } }) {
  if (solo) {
    return (
      <span className="ev-cb" title={thinking}>
        <span><i className="ev-cb-solo">{tags.solo}</i>{modelName(labels, thinking)}</span>
      </span>
    );
  }
  return (
    <span className="ev-cb" title={`${thinking} + ${execution}`}>
      <span><i className="ev-cb-th">{tags.th}</i>{modelName(labels, thinking)}</span>
      <span><i className="ev-cb-ex">{tags.ex}</i>{modelName(labels, execution)}</span>
    </span>
  );
}

export function VerdictChip({ v, label }: { v: "done" | "partial" | "failed"; label: string }) {
  return <span className={`ev-chip ${v === "done" ? "ev-ok" : v === "partial" ? "ev-mid" : "ev-bad"}`}>{label}</span>;
}

/** a horizontal bar that grows in on load */
export function Bar({ value, tone }: { value: number; tone?: "ok" | "mid" | "bad" | "accent" }) {
  const t = tone ?? (value >= 0.8 ? "ok" : value >= 0.6 ? "mid" : "bad");
  return (
    <div className="ev-bar">
      <i className={`ev-bar-${t}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

/** category radar (B): one polygon of the pass rates */
export function Radar({ items }: { items: { name: string; value: number }[] }) {
  const n = items.length;
  if (n < 3) return null;
  const cx = 125, cy = 112, R = 78;
  const pt = (i: number, r: number) => [cx + r * Math.sin((2 * Math.PI * i) / n), cy - r * Math.cos((2 * Math.PI * i) / n)];
  return (
    <svg className="mx-auto block" width="250" height="220" viewBox="0 0 250 220" role="img" aria-label={items.map((x) => `${x.name} ${Math.round(x.value * 100)}%`).join(", ")}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={items.map((_, i) => pt(i, R * f).join(",")).join(" ")} fill="none" stroke="var(--line)" />
      ))}
      {items.map((x, i) => {
        const [ex, ey] = pt(i, R);
        const [lx, ly] = pt(i, R + 18);
        return (
          <g key={x.name}>
            <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="var(--line)" />
            <text x={lx} y={ly} fontSize="11" fill="var(--muted)" textAnchor="middle" dominantBaseline="middle">{x.name}</text>
          </g>
        );
      })}
      <polygon className="ev-radar" points={items.map((x, i) => pt(i, R * x.value).join(",")).join(" ")} fill="color-mix(in srgb, var(--accent) 25%, transparent)" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}
