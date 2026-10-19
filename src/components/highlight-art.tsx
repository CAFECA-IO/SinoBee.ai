/**
 * Small honeycomb illustrations for the home page's "what sets SinoBee apart" cards.
 * Same tilted hexagonal prism as the hero (45° top face + two front faces), drawn in the theme's accent so it
 * follows light and dark mode. Each picture shows the mechanism its card describes.
 */

export type HighlightKey = "large" | "roles" | "memory" | "safety";
type Labels = Record<"m1" | "parallel" | "merge" | "plan" | "think" | "do" | "check" | "permanent" | "long" | "short" | "task", string>;

const TOP = "M0 -21.2L26 -10.6L26 10.6L0 21.2L-26 10.6L-26 -10.6Z";
const RIGHT = "M26 10.6L0 21.2L0 30.2L26 19.6Z";
const LEFT = "M0 21.2L-26 10.6L-26 19.6L0 30.2Z";

/** strength: 0 = outline only (planned), 1 = normal, 2 = emphasized */
function Prism({ x, y, s = 1, scale = 1, dashed = false, children }: { x: number; y: number; s?: 0 | 1 | 2; scale?: number; dashed?: boolean; children?: React.ReactNode }) {
  const face = [0.15, 0.24, 0.36][s];
  return (
    <g transform={`translate(${x} ${y})${scale !== 1 ? ` scale(${scale})` : ""}`} strokeLinejoin="round">
      <path d={RIGHT} fill="var(--accent)" fillOpacity={face} />
      <path d={LEFT} fill="var(--accent)" fillOpacity={face * 0.8} />
      <path d={TOP} fill={s === 0 ? "none" : "var(--accent)"} fillOpacity={[0, 0.1, 0.24][s]} stroke="var(--accent)" strokeOpacity={s === 2 ? 1 : 0.65} strokeWidth={(s === 2 ? 1.6 : 1.2) / scale} strokeDasharray={dashed ? "3 3" : undefined} />
      {children}
    </g>
  );
}

const label = { fontSize: 11, fill: "var(--muted)" } as const;
const strong = { fontSize: 14, fontWeight: 700, fill: "var(--accent)" } as const;

export function HighlightArt({ kind, labels, alt }: { kind: HighlightKey; labels: Labels; alt: string }) {
  return (
    <svg viewBox="0 0 200 170" className="h-auto w-full max-w-[200px]" role="img" aria-label={alt}>
      {kind === "large" && (
        <>
          <path d="M44 85H70M130 85H156M70 85V55H76M70 85V115H76M124 55H130V115H124" fill="none" stroke="var(--accent)" strokeOpacity=".5" strokeWidth="1.5" />
          <Prism x={30} y={85} s={2}><path d="M-7 0l5 5 9-9" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" /></Prism>
          <Prism x={100} y={52} />
          <Prism x={100} y={112} />
          <Prism x={170} y={85} s={0} dashed />
          <text x="30" y="140" textAnchor="middle" style={label}>{labels.m1}</text>
          <text x="100" y="20" textAnchor="middle" style={label}>{labels.parallel}</text>
          <text x="170" y="140" textAnchor="middle" style={label}>{labels.merge}</text>
        </>
      )}
      {kind === "roles" && (
        <>
          <path d="M66 60H130M100 76V108M126 120H158" fill="none" stroke="var(--accent)" strokeOpacity=".5" strokeWidth="1.5" />
          <path d="M124 56l6 4-6 4M96 102l4 6 4-6M152 116l6 4-6 4" fill="none" stroke="var(--accent)" strokeOpacity=".8" strokeWidth="1.5" />
          <Prism x={40} y={55} s={2}><text y="5" textAnchor="middle" style={strong}>{labels.think}</text></Prism>
          <Prism x={160} y={55}><text y="5" textAnchor="middle" style={strong}>{labels.check}</text></Prism>
          <Prism x={100} y={120} s={2}><text y="5" textAnchor="middle" style={strong}>{labels.do}</text></Prism>
          <rect x="160" y="108" width="34" height="24" rx="6" fill="none" stroke="var(--muted)" strokeWidth="1.2" />
          <path d="M168 116l4 4-4 4M175 124h10" fill="none" stroke="var(--muted)" strokeWidth="1.4" />
          <text x="100" y="52" textAnchor="middle" style={label}>{labels.plan}</text>
        </>
      )}
      {kind === "memory" && (
        <>
          <Prism x={70} y={128} s={0} />
          <Prism x={70} y={98} />
          <Prism x={70} y={68} />
          <Prism x={70} y={38} s={2}><path d="M-4-4h8v8h-8zM-2-4v-3a2 2 0 0 1 4 0v3" fill="none" stroke="var(--accent)" strokeWidth="1.4" /></Prism>
          <text x="106" y="42" style={{ ...label, fill: "var(--accent)", fontWeight: 700 }}>{labels.permanent}</text>
          <text x="106" y="72" style={label}>{labels.long}</text>
          <text x="106" y="102" style={label}>{labels.short}</text>
          <text x="106" y="132" style={label}>{labels.task}</text>
        </>
      )}
      {kind === "safety" && (
        <>
          <Prism x={70} y={85} s={1} scale={1.5} />
          <path d="M70 62l16 6v10c0 10-7 16-16 19-9-3-16-9-16-19V68z" fill="var(--panel)" stroke="var(--accent)" strokeWidth="1.8" />
          <path d="M63 79l5 5 9-9" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
          <rect x="130" y="40" width="62" height="96" rx="8" fill="var(--panel)" stroke="var(--line)" />
          <path d="M140 56h42M140 72h34M140 88h42M140 104h28M140 120h38" stroke="var(--muted)" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />
          <circle cx="137" cy="104" r="3" fill="var(--warn)" />
        </>
      )}
    </svg>
  );
}
