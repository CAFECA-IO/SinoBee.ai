import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { config } from "./config";

/**
 * Fonts for generated link-preview pictures (satori needs TTF/OTF/WOFF data; it has no CJK glyphs of its own).
 *  1. OG_FONT_PATH / OG_FONT_BOLD_PATH: local TTF or OTF files (offline servers)
 *  2. otherwise a Google Fonts-style CSS URL (crowd.ogFontUrl) asked for only the characters in the picture, so
 *     each download is a few kilobytes
 * Results are cached in memory. Returns [] when no font can be had; callers then fall back to a static picture.
 */

export type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

const NAME = "SinoBeeOG";
const cache = new Map<string, OgFont[]>();
let local: Promise<OgFont[]> | null = null;

const buf = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

async function localFonts(): Promise<OgFont[]> {
  const regular = process.env.OG_FONT_PATH;
  if (!regular) return [];
  const bold = process.env.OG_FONT_BOLD_PATH || regular;
  const [r, b] = await Promise.all([readFile(regular), readFile(bold)]);
  return [
    { name: NAME, data: buf(r), weight: 400, style: "normal" },
    { name: NAME, data: buf(b), weight: 700, style: "normal" },
  ];
}

async function remoteWeight(text: string, weight: 400 | 700): Promise<ArrayBuffer> {
  const base = config.crowd.ogFontUrl;
  const u = new URL(base);
  const fam = u.searchParams.get("family") ?? "Noto Sans TC";
  u.searchParams.set("family", `${fam.split(":")[0]}:wght@${weight}`);
  u.searchParams.set("text", text);
  // an old user agent gets TrueType instead of WOFF2 (satori does not read WOFF2)
  const css = await fetch(u, { headers: { "user-agent": "Mozilla/4.0" }, signal: AbortSignal.timeout(5000) }).then((r) => {
    if (!r.ok) throw new Error(`font css ${r.status}`);
    return r.text();
  });
  const src = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype|woff)'\)/)?.[1];
  if (!src) throw new Error("no TrueType font in the font CSS");
  const r = await fetch(src, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`font ${r.status}`);
  return r.arrayBuffer();
}

/** Fonts covering `text` (regular and bold) */
export async function ogFonts(text: string): Promise<OgFont[]> {
  if (process.env.OG_FONT_PATH) {
    local ??= localFonts().catch((e) => {
      console.warn("og font", (e as Error).message);
      local = null;
      return [];
    });
    return local;
  }
  const chars = [...new Set(text.replace(/\s/g, ""))].sort().join("");
  const key = createHash("sha1").update(chars).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const [r, b] = await Promise.all([remoteWeight(chars, 400), remoteWeight(chars, 700)]);
    const fonts: OgFont[] = [
      { name: NAME, data: r, weight: 400, style: "normal" },
      { name: NAME, data: b, weight: 700, style: "normal" },
    ];
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    cache.set(key, fonts);
    return fonts;
  } catch (e) {
    console.warn("og font", (e as Error).message);
    return [];
  }
}

export const OG_FONT_FAMILY = NAME;
