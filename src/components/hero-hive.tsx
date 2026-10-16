"use client";

import { useEffect, useRef } from "react";

/**
 * Landing-page hero: robot bees working in a honeycomb (pure SVG + SMIL, loops forever).
 * Each bee leaves its spot at the hive core, works two cells (they light up), and flies back to recharge.
 * Geometry is computed deterministically so server and client render the same markup.
 * prefers-reduced-motion: the animation is paused on a representative frame.
 */

const W = 600;
const H = 420;
const R = 40; // hex radius (pointy top)
const DX = R * Math.sqrt(3);
const DY = R * 1.5;
const COLS = 7;
const ROWS = 6;
const X0 = (W - (COLS - 0.5) * DX) / 2 + DX / 2;
const Y0 = 50;
const DUR = 12; // seconds per bee cycle

const center = (row: number, col: number): [number, number] => [X0 + col * DX + (row % 2 ? DX / 2 : 0), Y0 + row * DY];
const hex = ([cx, cy]: [number, number], r: number) =>
  "M" +
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join("L") +
  "Z";

const ICONS = {
  doc: "M-7-9h9l5 5v13h-14zM2-9v5h5M-4 1h8M-4 5h8",
  chart: "M-8 8V-8M-8 8H8M-4 4V0M0 4V-4M4 4V-2",
  code: "M-4-5-9 0l5 5M4-5 9 0 4 5M2-8-2 8",
  globe: "M0 9a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM-9 0H9M0-9a14 14 0 0 1 0 18M0-9a14 14 0 0 0 0 18",
  term: "M-8-6l5 5-5 5M0 6h8",
  db: "M0-4c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM-8-7V7c0 1.7 3.6 3 8 3s8-1.3 8-3V-7",
  folder: "M-9-5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H-7a2 2 0 0 1-2-2z",
  video: "M-9-6h12v12H-9zM3-2l6-3v10l-6-3",
} as const;
type IconKey = keyof typeof ICONS;

const CORE: [number, number] = [2, 3];
/** each bee: two work cells it visits, and its parking offset at the core */
const BEES: { cells: [[number, number, IconKey], [number, number, IconKey]]; park: [number, number] }[] = [
  { cells: [[1, 1, "globe"], [0, 2, "doc"]], park: [-16, -10] },
  { cells: [[1, 5, "chart"], [0, 4, "code"]], park: [16, -10] },
  { cells: [[4, 5, "db"], [3, 5, "term"]], park: [16, 12] },
  { cells: [[4, 1, "folder"], [3, 0, "video"]], park: [-16, 12] },
];

// flight plan (seconds): fly, hover, fly, hover, fly home, recharge
const FLY = 1.6;
const HOVER = 1.5;
const T = [0, FLY, FLY + HOVER, 2 * FLY + HOVER, 2 * FLY + 2 * HOVER, 3 * FLY + 2 * HOVER, DUR].map((t) => t / DUR);
const EASE = ".45 0 .55 1";
const STILL = "0 0 1 1";
const SPLINES = [EASE, STILL, EASE, STILL, EASE, STILL].join(";");
const kt = (n: number) => n.toFixed(4);
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function plan(i: number) {
  const core = center(...CORE);
  const home: [number, number] = [core[0] + BEES[i].park[0], core[1] + BEES[i].park[1]];
  const a = center(BEES[i].cells[0][0], BEES[i].cells[0][1]);
  const b = center(BEES[i].cells[1][0], BEES[i].cells[1][1]);
  const la = dist(home, a);
  const lb = la + dist(a, b);
  const lt = lb + dist(b, home);
  return {
    path: `M${home[0].toFixed(1)} ${home[1].toFixed(1)}L${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}Z`,
    keyPoints: [0, la / lt, la / lt, lb / lt, lb / lt, 1, 1].map(kt).join(";"),
    begin: `${-i * (DUR / BEES.length)}s`,
    arrive: [T[1], T[3]],
  };
}

/** a work cell lights up when its bee arrives and dims just before the bee's next round */
function lightTimes(arrive: number) {
  return { values: "0;0;1;1;0;0", keyTimes: [0, arrive, arrive + 0.03, 0.9, 0.96, 1].map(kt).join(";") };
}

export function HeroHive({ label }: { label: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (!svg) return;
      if (mq.matches) {
        svg.setCurrentTime(5.5); // bees out working, most cells lit
        svg.pauseAnimations();
      } else svg.unpauseAnimations();
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const cells: [number, number][] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) cells.push([row, col]);
  const plans = BEES.map((_, i) => plan(i));
  const core = center(...CORE);

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full">
      <defs>
        <linearGradient id="hh-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2fb3a0" />
          <stop offset="1" stopColor="#7fe8b6" />
        </linearGradient>
        <linearGradient id="hh-wing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#cfe9f5" stopOpacity=".9" />
          <stop offset="1" stopColor="#7fb2c9" stopOpacity=".35" />
        </linearGradient>
        <radialGradient id="hh-glow">
          <stop offset="0" stopColor="var(--accent)" stopOpacity=".5" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hh-bg" cx="50%" cy="45%" r="70%">
          <stop offset="0" stopColor="var(--panel-2)" />
          <stop offset="1" stopColor="var(--bg)" />
        </radialGradient>
        {/* robot bee centred on 0,0 (~46px) */}
        <g id="hh-bee">
          <g>
            <ellipse cx="-8" cy="-12" rx="10" ry="6" fill="url(#hh-wing)" stroke="#9fd3e6" strokeWidth=".8">
              <animateTransform attributeName="transform" type="rotate" values="-25 -3 -6;-58 -3 -6;-25 -3 -6" dur=".16s" repeatCount="indefinite" />
            </ellipse>
            <ellipse cx="8" cy="-12" rx="10" ry="6" fill="url(#hh-wing)" stroke="#9fd3e6" strokeWidth=".8">
              <animateTransform attributeName="transform" type="rotate" values="25 3 -6;58 3 -6;25 3 -6" dur=".16s" repeatCount="indefinite" />
            </ellipse>
          </g>
          <ellipse cx="0" cy="3" rx="11" ry="13" fill="url(#hh-body)" />
          <path d="M-10.4 0h20.8M-9 7h18" stroke="#0b1627" strokeWidth="2.6" />
          <path d="M0 16v4.5" stroke="#7fe8b6" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="0" cy="-8" r="6.8" fill="#0f2a35" stroke="#2fb3a0" strokeWidth="1.3" />
          <rect x="-4.2" y="-9.8" width="8.4" height="3.4" rx="1.7" fill="#6fe3b0">
            <animate attributeName="opacity" values="1;.35;1" dur="1.6s" repeatCount="indefinite" />
          </rect>
          <path d="M-3.4-14-6.5-20M3.4-14 6.5-20" stroke="#86a0a4" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="-6.6" cy="-20.6" r="1.8" fill="#f5b83d" />
          <circle cx="6.6" cy="-20.6" r="1.8" fill="#f5b83d" />
        </g>
      </defs>

      <rect width={W} height={H} fill="url(#hh-bg)" />

      {/* honeycomb */}
      {cells.map(([row, col]) => (
        <path key={`c${row}-${col}`} d={hex(center(row, col), R - 3)} fill="var(--panel-2)" stroke="var(--line)" strokeWidth="1.5" />
      ))}

      {/* hive core: where bees recharge */}
      <circle cx={core[0]} cy={core[1]} r="70" fill="url(#hh-glow)">
        <animate attributeName="r" values="58;78;58" dur="3s" repeatCount="indefinite" />
      </circle>
      <path d={hex(core, R - 3)} fill="var(--accent)" fillOpacity=".16" stroke="var(--accent)" strokeWidth="2" />

      {/* work cells (light up when a bee works on them) */}
      {BEES.map((bee, i) =>
        bee.cells.map(([row, col, icon], j) => {
          const c = center(row, col);
          const lt = lightTimes(plans[i].arrive[j]);
          const anim = { dur: `${DUR}s`, begin: plans[i].begin, repeatCount: "indefinite" as const, values: lt.values, keyTimes: lt.keyTimes };
          return (
            <g key={`w${i}-${j}`}>
              <path d={hex(c, R - 3)} fill="var(--accent)" fillOpacity="0" stroke="var(--accent)" strokeWidth="2" strokeOpacity="0">
                <animate attributeName="fill-opacity" {...anim} values={lt.values.replace(/1/g, ".2")} />
                <animate attributeName="stroke-opacity" {...anim} />
              </path>
              <g transform={`translate(${c[0].toFixed(1)} ${c[1].toFixed(1)}) scale(1.35)`} fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONS[icon]} stroke="var(--muted)" opacity=".55" />
                <path d={ICONS[icon]} stroke="var(--accent)" opacity="0">
                  <animate attributeName="opacity" {...anim} />
                </path>
              </g>
            </g>
          );
        }),
      )}

      {/* bees */}
      {plans.map((p, i) => (
        <g key={`b${i}`}>
          <g>
            <use href="#hh-bee">
              <animateTransform attributeName="transform" type="translate" values="0 -2;0 2;0 -2" dur={`${1.1 + i * 0.13}s`} repeatCount="indefinite" />
            </use>
          </g>
          <animateMotion dur={`${DUR}s`} begin={p.begin} repeatCount="indefinite" path={p.path} keyPoints={p.keyPoints} keyTimes={T.map(kt).join(";")} calcMode="spline" keySplines={SPLINES} />
        </g>
      ))}
    </svg>
  );
}
