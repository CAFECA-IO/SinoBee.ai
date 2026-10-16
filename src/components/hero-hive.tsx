"use client";

import { useEffect, useRef } from "react";

/**
 * Landing-page hero (pure SVG + SMIL, loops forever, transparent background).
 * A honeycomb seen at 45°: hexagonal cells drift upward at different speeds and fade out. Bumblebee-shaped bees
 * chase a rising cell, catch it, smash it into shards and a result icon (the finished task) floats up.
 * Geometry is computed deterministically so the server and the client render the same markup.
 * prefers-reduced-motion: the animation is paused on a representative frame.
 */

const W = 600;
const H = 460;
const R = 30; // hex radius (pointy top) before the 45° tilt
const K = Math.SQRT1_2; // cos 45°: depth axis foreshortening
const D = 9; // prism thickness
const f = (n: number) => n.toFixed(1);
type P = [number, number];

/** hexagon vertices on the tilted plane, around (0, 0) */
const verts = (r: number): P[] =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return [r * Math.cos(a), r * Math.sin(a) * K];
  });
const poly = (pts: P[]) => "M" + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L") + "Z";

/** a hexagonal prism seen from above at 45°: top face + the two front faces */
function Prism({ r = R, strong = false }: { r?: number; strong?: boolean }) {
  const v = verts(r);
  const down = (p: P): P => [p[0], p[1] + D];
  // vertices 1→2→3→4 are the lower-right, bottom and lower-left corners; faces 1-2 and 2-3 and 3-4 face the viewer
  const faces = [
    [v[1], v[2]],
    [v[2], v[3]],
    [v[3], v[4]],
  ].map(([a, b]) => poly([a, b, down(b), down(a)]));
  return (
    <g strokeLinejoin="round">
      {faces.map((d, i) => (
        <path key={i} d={d} fill="var(--accent)" fillOpacity={strong ? 0.4 : 0.22 + i * 0.04} stroke="var(--accent)" strokeOpacity={strong ? 0.9 : 0.5} strokeWidth="1" />
      ))}
      <path d={poly(v)} fill="var(--accent)" fillOpacity={strong ? 0.24 : 0.1} stroke="var(--accent)" strokeOpacity={strong ? 1 : 0.65} strokeWidth={strong ? 1.8 : 1.2} />
    </g>
  );
}

/** deterministic PRNG (mulberry32) so SSR and hydration match */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── drifting honeycomb: a tilted grid, each cell rises with its own speed and fades out ──
const DX = R * Math.sqrt(3);
const DY = R * 1.5 * K;
const DRIFT = (() => {
  const rand = rng(8018);
  const cells: { x: number; y: number; dur: number; begin: number; rise: number; scale: number }[] = [];
  for (let row = 0; row < 6; row++)
    for (let col = 0; col < 7; col++) {
      if (rand() < 0.55) continue;
      const x = 48 + col * DX * 1.1 + (row % 2 ? DX * 0.55 : 0);
      const y = 270 + row * DY * 1.25;
      if (x > W - 30) continue;
      const dur = 6 + rand() * 8; // different speeds
      cells.push({ x, y, dur, begin: -rand() * dur, rise: 120 + rand() * 120, scale: 0.75 + rand() * 0.35 });
    }
  return cells;
})();

// ── bees and their targets ──
const ICONS = {
  doc: "M-7-9h9l5 5v13h-14zM2-9v5h5M-4 1h8M-4 5h8",
  chart: "M-8 8V-8M-8 8H8M-4 4V0M0 4V-4M4 4V-2",
  code: "M-4-5-9 0l5 5M4-5 9 0 4 5M2-8-2 8",
  image: "M-9-7h18v14h-18zM-9 4l5-5 4 4 3-3 6 6M3-3a1.5 1.5 0 1 0 0-.1",
  check: "M-7 0l4.5 4.5L7-5",
} as const;
type IconKey = keyof typeof ICONS;

/** A: where the bee waits; H0: where its target cell starts; rise: how far the cell drifts before it is caught */
const BEES: { A: P; H0: P; rise: number; dur: number; begin: number; icon: IconKey }[] = [
  { A: [52, 300], H0: [190, 420], rise: 175, dur: 8, begin: 0, icon: "doc" },
  { A: [556, 330], H0: [420, 430], rise: 175, dur: 9.5, begin: -3.1, icon: "chart" },
  { A: [92, 120], H0: [300, 400], rise: 245, dur: 11, begin: -6.4, icon: "code" },
  { A: [520, 96], H0: [520, 410], rise: 225, dur: 10, begin: -1.7, icon: "image" },
];

// timeline of one bee cycle (fractions): cell appears, bee launches, catch, bee leaves, bee home
const U = { appear: 0.04, launch: 0.12, catch: 0.55, leave: 0.62, home: 0.94 };

const cubicLen = (p0: P, p1: P, p2: P, p3: P) => {
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= 40; i++) {
    const t = i / 40;
    const m = 1 - t;
    const q: P = [
      m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
      m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
    ];
    len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    prev = q;
  }
  return len;
};

const PLANS = BEES.map((b) => {
  const I: P = [b.H0[0], b.H0[1] - b.rise];
  const side = Math.sign(I[0] - b.A[0]) || 1;
  // chase: swoop down behind the rising cell and come at it from below
  const c1: P = [b.A[0] + side * 40, b.A[1] + 90];
  const c2: P = [I[0] - side * 30, I[1] + 110];
  // leave: up and away, back to the waiting spot
  const c3: P = [I[0] + side * 50, I[1] - 70];
  const c4: P = [b.A[0] + side * 30, b.A[1] - 60];
  const l1 = cubicLen(b.A, c1, c2, I);
  const l2 = cubicLen(I, c3, c4, b.A);
  const h = l1 / (l1 + l2);
  const path = `M${f(b.A[0])} ${f(b.A[1])}C${[c1, c2, I].map((p) => `${f(p[0])} ${f(p[1])}`).join(" ")}C${[c3, c4, b.A].map((p) => `${f(p[0])} ${f(p[1])}`).join(" ")}`;
  const facing = side; // +1 = facing right
  return { ...b, I, path, h, facing };
});

const kt = (...n: number[]) => n.map((x) => x.toFixed(3)).join(";");
const EASE = ".45 0 .55 1";
const LIN = "0 0 1 1";

/** shards of the smashed cell: the six triangles from the centre to each edge */
const SHARDS = (() => {
  const v = verts(R);
  return v.map((a, i) => {
    const b = v[(i + 1) % 6];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const n = Math.hypot(mx, my) || 1;
    return { d: poly([[0, 0], a, b]), dx: (mx / n) * 30, dy: (my / n) * 30 + 22, rot: (i % 2 ? 1 : -1) * (40 + i * 12), cx: mx / 1.5, cy: my / 1.5 };
  });
})();

export function HeroHive({ label }: { label: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (mq.matches) {
        svg.setCurrentTime(5);
        svg.pauseAnimations();
      } else svg.unpauseAnimations();
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full overflow-visible">
      <defs>
        <radialGradient id="hh-wing" cx=".35" cy=".35" r=".8">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".9" />
          <stop offset="1" stopColor="#bfe3f0" stopOpacity=".35" />
        </radialGradient>
        <clipPath id="hh-body-clip">
          <ellipse cx="0" cy="2" rx="16" ry="13.5" />
        </clipPath>
        {/* bumblebee, facing right, ~46 px wide */}
        <g id="hh-bee">
          {/* wings (behind) */}
          <g transform="translate(-2 -9)">
            <ellipse cx="-6" cy="-6" rx="8" ry="11" transform="rotate(-25)" fill="url(#hh-wing)" stroke="#9fcfe0" strokeWidth=".8">
              <animateTransform attributeName="transform" type="rotate" values="-25;-55;-25" dur=".12s" repeatCount="indefinite" />
            </ellipse>
            <ellipse cx="5" cy="-5" rx="7" ry="10" transform="rotate(20)" fill="url(#hh-wing)" stroke="#9fcfe0" strokeWidth=".8">
              <animateTransform attributeName="transform" type="rotate" values="20;48;20" dur=".12s" repeatCount="indefinite" />
            </ellipse>
          </g>
          {/* legs */}
          <path d="M-6 14l-2 5M0 15.5l0 5M6 14l2 5" stroke="#241d16" strokeWidth="1.8" strokeLinecap="round" />
          {/* round fuzzy body with bands: dark thorax, yellow, dark, white tail */}
          <ellipse cx="0" cy="2" rx="16.5" ry="14" fill="#f3b72e" stroke="#f3b72e" strokeWidth="2.6" strokeDasharray="1.2 1.6" />
          <g clipPath="url(#hh-body-clip)">
            <rect x="-17" y="-12" width="34" height="28" fill="#f3b72e" />
            <rect x="4" y="-12" width="13" height="28" fill="#2a2119" />
            <rect x="-8" y="-12" width="5.5" height="28" fill="#2a2119" />
            <rect x="-17" y="-12" width="6" height="28" fill="#f6efdc" />
          </g>
          <ellipse cx="-4" cy="-4" rx="7" ry="3.5" fill="#fff" opacity=".22" />
          {/* head with a glowing visor (robot bee) */}
          <circle cx="16" cy="1" r="7.5" fill="#2a2119" stroke="#2a2119" strokeWidth="1.6" strokeDasharray="1 1.4" />
          <rect x="15" y="-2.2" width="6.5" height="3.6" rx="1.8" fill="#6fe3b0">
            <animate attributeName="opacity" values="1;1;.15;1;1" keyTimes="0;.9;.94;.98;1" dur="4s" repeatCount="indefinite" />
          </rect>
          <path d="M14-5l-2-7M18-5l3-6" stroke="#2a2119" strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <circle cx="12" cy="-12" r="1.6" fill="#6fe3b0" />
          <circle cx="21" cy="-11" r="1.6" fill="#6fe3b0" />
          {/* stinger */}
          <path d="M-17.5 3l-4 1 4 1.5z" fill="#2a2119" />
        </g>
      </defs>

      {/* drifting honeycomb */}
      {DRIFT.map((c, i) => (
        <g key={`d${i}`} transform={`translate(${f(c.x)} ${f(c.y)})`}>
          <g opacity="0">
            <animateTransform attributeName="transform" type="translate" values={`0 0;0 ${f(-c.rise)}`} dur={`${c.dur.toFixed(2)}s`} begin={`${c.begin.toFixed(2)}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;.9;.75;0" keyTimes="0;.15;.6;1" dur={`${c.dur.toFixed(2)}s`} begin={`${c.begin.toFixed(2)}s`} repeatCount="indefinite" />
            <g transform={`scale(${c.scale.toFixed(2)})`}>
              <Prism />
            </g>
          </g>
        </g>
      ))}

      {PLANS.map((b, i) => {
        const dur = `${b.dur}s`;
        const begin = `${b.begin}s`;
        const anim = { dur, begin, repeatCount: "indefinite" } as const;
        return (
          <g key={`b${i}`}>
            {/* the target cell: appears, rises toward the catch point, vanishes when hit */}
            <g transform={`translate(${f(b.H0[0])} ${f(b.H0[1])})`}>
              <g opacity="0">
                <animateTransform attributeName="transform" type="translate" values={`0 0;0 0;0 ${f(-b.rise)};0 ${f(-b.rise)}`} keyTimes={kt(0, U.appear, U.catch, 1)} {...anim} />
                <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={kt(0, U.appear, U.appear + 0.06, U.catch, U.catch + 0.005, 1)} {...anim} />
                <Prism strong />
              </g>
            </g>

            {/* impact: flash ring + shards */}
            <g transform={`translate(${f(b.I[0])} ${f(b.I[1])})`}>
              <ellipse rx="10" ry={f(10 * K)} fill="none" stroke="var(--accent)" strokeWidth="2" opacity="0">
                <animate attributeName="opacity" values="0;0;.9;0;0" keyTimes={kt(0, U.catch, U.catch + 0.01, U.catch + 0.1, 1)} {...anim} />
                <animate attributeName="rx" values="10;10;46;46" keyTimes={kt(0, U.catch, U.catch + 0.1, 1)} {...anim} />
                <animate attributeName="ry" values={`${f(10 * K)};${f(10 * K)};${f(46 * K)};${f(46 * K)}`} keyTimes={kt(0, U.catch, U.catch + 0.1, 1)} {...anim} />
              </ellipse>
              {SHARDS.map((s, k) => (
                <g key={k} opacity="0">
                  <animate attributeName="opacity" values="0;0;1;0;0" keyTimes={kt(0, U.catch, U.catch + 0.005, U.catch + 0.17, 1)} {...anim} />
                  <animateTransform attributeName="transform" type="translate" values={`0 0;0 0;${f(s.dx)} ${f(s.dy)};${f(s.dx)} ${f(s.dy)}`} keyTimes={kt(0, U.catch, U.catch + 0.17, 1)} calcMode="spline" keySplines={[LIN, ".2 .7 .4 1", LIN].join(";")} {...anim} />
                  <path d={s.d} transform="scale(.8)" fill="var(--accent)" fillOpacity=".45" stroke="var(--accent)" strokeWidth="1.2" strokeLinejoin="round">
                    <animateTransform attributeName="transform" type="rotate" values={`0 ${f(s.cx)} ${f(s.cy)};0 ${f(s.cx)} ${f(s.cy)};${s.rot} ${f(s.cx)} ${f(s.cy)};${s.rot} ${f(s.cx)} ${f(s.cy)}`} keyTimes={kt(0, U.catch, U.catch + 0.17, 1)} additive="sum" {...anim} />
                  </path>
                </g>
              ))}
            </g>

            {/* result icon floats up out of the shards */}
            <g transform={`translate(${f(b.I[0])} ${f(b.I[1] - 6)})`}>
              <g opacity="0">
                <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={kt(0, U.catch + 0.02, U.catch + 0.07, 0.84, 0.96, 1)} {...anim} />
                <animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -46;0 -46" keyTimes={kt(0, U.catch + 0.02, 0.96, 1)} calcMode="spline" keySplines={[LIN, ".2 .6 .4 1", LIN].join(";")} {...anim} />
                <g>
                  <animateTransform attributeName="transform" type="scale" values=".4;.4;1.15;1;1" keyTimes={kt(0, U.catch + 0.02, U.catch + 0.07, U.catch + 0.11, 1)} {...anim} />
                  <circle r="17" fill="var(--accent)" fillOpacity=".16" stroke="var(--accent)" strokeOpacity=".7" strokeWidth="1.2" />
                  <path d={ICONS[b.icon]} transform="scale(1.05)" fill="none" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </g>
            </g>

            {/* the bee: waits, chases the cell, hits it, flies back */}
            <g>
              <animateMotion
                path={b.path}
                keyPoints={kt(0, 0, b.h, b.h, 1, 1)}
                keyTimes={kt(0, U.launch, U.catch, U.leave, U.home, 1)}
                calcMode="spline"
                keySplines={[LIN, ".5 0 .7 1", LIN, ".4 0 .5 1", LIN].join(";")}
                {...anim}
              />
              <g transform={`scale(${b.facing} 1)`}>
                <animateTransform attributeName="transform" type="scale" values={`${b.facing} 1;${-b.facing} 1`} keyTimes={kt(0, U.leave)} calcMode="discrete" {...anim} />
                <g>
                  {/* hover bob, plus a jolt on impact */}
                  <animateTransform attributeName="transform" type="translate" values="0 0;0 0;-4 -3;3 2;0 0;0 0" keyTimes={kt(0, U.catch, U.catch + 0.015, U.catch + 0.03, U.catch + 0.05, 1)} {...anim} />
                  <use href="#hh-bee" transform="scale(1.3)">
                    <animateTransform attributeName="transform" type="translate" values="0 -2;0 2;0 -2" dur={`${(1 + i * 0.17).toFixed(2)}s`} additive="sum" repeatCount="indefinite" />
                  </use>
                </g>
              </g>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
