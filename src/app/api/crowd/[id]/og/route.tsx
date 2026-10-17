import { ImageResponse } from "next/og";
import { config } from "@/lib/config";
import { OG_FONT_FAMILY, ogFonts } from "@/lib/og-font";
import { OG_SIZE, clip, crowdShare, type CrowdShare } from "@/lib/crowd/share";

/**
 * The campaign's link-preview picture (Open Graph / X card), 1200×630 PNG. Crawlers fetch it without signing in, so
 * it is served only for public campaigns. The `v` parameter is a version of what the picture shows: URLs with the
 * current version are cached for a day, others briefly (platforms keep pictures by URL).
 */

export const dynamic = "force-dynamic";

const C = { bg: "#060d1b", bg2: "#0d2a2c", ink: "#e3f3ec", muted: "#9db8b0", accent: "#6fe3b0", accent2: "#2fb3a0", line: "#1c3a3a", warn: "#ffd27a" };
const ICON =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="1.8"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fb3a0"/><stop offset="1" stop-color="#7fe8b6"/></linearGradient></defs><rect width="24" height="24" rx="6" fill="#0b1528"/><ellipse cx="12" cy="14" rx="5" ry="6" fill="url(#g)"/><path d="M7.5 12h9M7.5 15.5h9" stroke="#0b1528"/><path d="M9 8c-3-4-7-2-6 1s5 2 6 1M15 8c3-4 7-2 6 1s-5 2-6 1" stroke="#6fe3b0"/></svg>',
  ).toString("base64");

const rendered = new Map<string, Uint8Array>();

function texts(s: CrowdShare) {
  const zh = s.locale === "zh-TW";
  const money = (n: number) => `NT$${n.toLocaleString("en-US")}`;
  const titleSize = [...s.fullTitle].length <= 14 ? 72 : [...s.fullTitle].length <= 28 ? 58 : 48;
  return {
    zh,
    brand: zh ? "SinoBee.ai 眾籌" : "SinoBee.ai Crowdfunding",
    title: clip(s.fullTitle, titleSize >= 58 ? 34 : 56),
    titleSize,
    summary: clip(s.summary, zh ? 64 : 120),
    amount: money(s.pledged),
    goal: zh ? `目標 ${money(s.goal)}` : `of ${money(s.goal)} goal`,
    stats: [
      `${s.percent}%`,
      zh ? `${s.backers} 人出資` : `${s.backers} backer${s.backers === 1 ? "" : "s"}`,
      ...(s.daysLeft !== null ? [zh ? `剩 ${s.daysLeft} 天` : `${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`] : []),
    ],
    footer: zh ? `每份 ${money(s.sharePrice)} · 未達標不扣款` : `${money(s.sharePrice)} a share · no charge unless funded`,
    by: zh ? `發起人 ${s.proposer}` : `by ${s.proposer}`,
  };
}

function Picture({ s }: { s: CrowdShare }) {
  const x = texts(s);
  const pct = Math.min(100, Math.max(s.percent > 0 ? 2 : 0, s.percent));
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "56px 64px", background: `linear-gradient(135deg, ${C.bg} 0%, ${C.bg} 55%, ${C.bg2} 100%)`, color: C.ink, fontFamily: OG_FONT_FAMILY }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ICON} width={52} height={52} alt="" />
          <div style={{ fontSize: 30, fontWeight: 700, color: C.accent }}>{x.brand}</div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {s.category && <div style={{ display: "flex", fontSize: 24, padding: "8px 20px", borderRadius: 999, border: `2px solid ${C.line}`, color: C.muted }}>{s.category}</div>}
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700, padding: "8px 20px", borderRadius: 999, background: s.stage === "open" ? C.accent : s.stage === "unfunded" ? "#3a2a2a" : C.line, color: s.stage === "open" ? C.bg : s.stage === "unfunded" ? C.warn : C.ink }}>
            {s.stageLabel}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 44, flexGrow: 1 }}>
        <div style={{ display: "flex", fontSize: x.titleSize, fontWeight: 700, lineHeight: 1.18, letterSpacing: -0.5 }}>{x.title}</div>
        {x.summary && <div style={{ display: "flex", marginTop: 20, fontSize: 28, lineHeight: 1.4, color: C.muted }}>{x.summary}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
          <div style={{ fontSize: 56, fontWeight: 700, color: C.accent }}>{x.amount}</div>
          <div style={{ fontSize: 28, color: C.muted, paddingBottom: 10 }}>{x.goal}</div>
        </div>
        <div style={{ display: "flex", marginTop: 14, height: 18, borderRadius: 999, background: C.line, overflow: "hidden" }}>
          <div style={{ display: "flex", width: `${pct}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${C.accent2}, ${C.accent})` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, fontSize: 26, color: C.ink }}>
          <div style={{ display: "flex", gap: 28 }}>
            {x.stats.map((t, i) => (
              <div key={i} style={{ display: "flex", fontWeight: i === 0 ? 700 : 400 }}>{t}</div>
            ))}
          </div>
          <div style={{ display: "flex", color: C.muted }}>{x.by}</div>
        </div>
        <div style={{ display: "flex", marginTop: 14, fontSize: 22, color: C.muted }}>{x.footer}</div>
      </div>
    </div>
  );
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const u = new URL(req.url);
  const s = await crowdShare(id, u.searchParams.get("l") ?? "zh-TW");
  if (!s) return new Response("not found", { status: 404 });
  const current = u.searchParams.get("v") === s.version;
  const headers = {
    "content-type": "image/png",
    "cache-control": current ? "public, max-age=86400" : "public, max-age=300",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "cross-origin",
  };
  const key = `${s.id}|${s.locale}|${s.version}`;
  const hit = rendered.get(key);
  if (hit) return new Response(new Uint8Array(hit), { headers });
  const x = texts(s);
  const all = [x.brand, x.title, x.summary, x.amount, x.goal, ...x.stats, x.footer, x.by, s.category ?? "", s.stageLabel].join("");
  const fonts = await ogFonts(all);
  // without a font that has these characters the picture would be blank: use the site picture instead
  if (!fonts.length && /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(all)) return Response.redirect(`${config.origin}/screenshots/usecase-research.png`, 302);
  const img = new ImageResponse(<Picture s={s} />, { ...OG_SIZE, fonts: fonts.length ? fonts : undefined });
  const body = new Uint8Array(await img.arrayBuffer());
  if (rendered.size > 200) rendered.delete(rendered.keys().next().value!);
  rendered.set(key, body);
  return new Response(new Uint8Array(body), { headers });
}
