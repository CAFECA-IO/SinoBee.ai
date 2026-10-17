import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { db } from "../db";
import { config } from "../config";
import { normalizeSpec, sharePrice } from "./rules";
import { pledgeTotals } from "./pledges";

/**
 * Link previews for crowdfunding campaigns (Facebook, LINE, X, Threads, LinkedIn, Telegram, WhatsApp, Discord, Slack):
 * a 1200×630 picture (1.91:1, PNG well under every platform's size limit), a title of at most 60 characters and a
 * description of at most 160. The picture URL carries a version derived from what it shows (title, summary, status,
 * progress), so platforms that cache pictures by URL fetch a new one when the campaign changes.
 */

const DAY = 86_400_000;
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

export type CrowdShare = {
  id: string;
  locale: "zh-TW" | "en";
  title: string;
  fullTitle: string;
  summary: string;
  description: string;
  category: string | null;
  status: string;
  stage: "open" | "funded" | "review" | "completed" | "unfunded" | "screening";
  stageLabel: string;
  goal: number;
  pledged: number;
  percent: number;
  backers: number;
  daysLeft: number | null;
  proposer: string;
  sharePrice: number;
  version: string;
  url: string;
  imageUrl: string;
  imageAlt: string;
};

const CATEGORY: Record<string, [string, string]> = {
  research: ["研究調查", "Research"],
  data: ["資料整理", "Data"],
  writing: ["寫作報告", "Writing"],
  code: ["程式工具", "Code"],
  translation: ["翻譯", "Translation"],
  media: ["影音圖像", "Media"],
  other: ["其他", "Other"],
};

const STAGE: Record<CrowdShare["stage"], [string, string]> = {
  screening: ["審核中", "In screening"],
  open: ["募資中", "Funding"],
  funded: ["募資成功・執行中", "Funded · in progress"],
  review: ["驗收中", "In review"],
  completed: ["已完成", "Completed"],
  unfunded: ["未達標", "Not funded"],
};

function stageOf(status: string): CrowdShare["stage"] {
  if (status === "FUNDING") return "open";
  if (status === "SCREENING") return "screening";
  if (status === "IN_REVIEW" || status === "DISPUTED") return "review";
  if (status === "COMPLETED") return "completed";
  if (status === "UNFUNDED" || status === "CANCELLED" || status === "FAILED") return "unfunded";
  return "funded";
}

/** Cut to `max` characters (code points), ending with … */
export function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  const cps = [...one];
  return cps.length <= max ? one : cps.slice(0, max - 1).join("").trimEnd() + "…";
}

const money = (n: number) => `NT$${n.toLocaleString("en-US")}`;
export const localePath = (locale: string, path: string) => (locale === "en" ? `/en${path}` : path);

/** What a link preview of this campaign shows; null when it is not public */
export async function crowdShare(id: string, locale: string, now = new Date()): Promise<CrowdShare | null> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  const t = await db.task.findUnique({
    where: { id },
    select: { id: true, title: true, prompt: true, isPublic: true, status: true, crowdfund: true, takenDownAt: true, spec: true, goalTwd: true, deadlineAt: true, category: true, user: { select: { handle: true, account: true } } },
  });
  if (!t?.crowdfund || !t.isPublic || t.takenDownAt || t.status === "DRAFT") return null;
  const zh = !locale.startsWith("en");
  const loc = zh ? "zh-TW" : "en";
  const spec = t.spec ? normalizeSpec(t.spec) : null;
  const summary = (spec?.summary || t.prompt.replace(/^#.*$/m, "")).replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
  const totals = await pledgeTotals(t.id);
  const goal = t.goalTwd ?? 0;
  const percent = goal ? Math.floor((totals.pledged / goal) * 100) : 0;
  const stage = stageOf(t.status);
  const daysLeft = stage === "open" && t.deadlineAt ? Math.max(0, Math.ceil((t.deadlineAt.getTime() - now.getTime()) / DAY)) : null;
  const price = sharePrice();
  const progress = zh
    ? stage === "open"
      ? `目標 ${money(goal)}，已達 ${percent}%，${totals.backers} 人出資${daysLeft !== null ? `，剩 ${daysLeft} 天` : ""}。每份 ${money(price)}，未達標不扣款。`
      : `${STAGE[stage][0]}：目標 ${money(goal)}，${totals.backers} 人出資。`
    : stage === "open"
      ? `Goal ${money(goal)}, ${percent}% pledged by ${totals.backers} backer${totals.backers === 1 ? "" : "s"}${daysLeft !== null ? `, ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}. ${money(price)} a share; no charge unless funded.`
      : `${STAGE[stage][1]}: goal ${money(goal)}, ${totals.backers} backer${totals.backers === 1 ? "" : "s"}.`;
  const room = DESCRIPTION_MAX - [...progress].length - 1;
  // no space after full-width punctuation (。！？) in Chinese
  const lead = room >= 20 && summary ? clip(summary, room) : "";
  const description = lead ? `${lead}${/[。！？」]$/.test(lead) ? "" : " "}${progress}` : clip(progress, DESCRIPTION_MAX);
  const proposer = t.user.handle ? `@${t.user.handle}` : `${t.user.account.slice(0, 6)}…${t.user.account.slice(-4)}`;
  const category = t.category && CATEGORY[t.category] ? CATEGORY[t.category][zh ? 0 : 1] : null;
  // what the picture shows; progress rounded so the URL does not change with every pledge
  const version = createHash("sha1")
    .update(JSON.stringify([loc, t.title, summary.slice(0, 200), category, stage, goal, Math.floor(percent / 5), totals.backers, daysLeft, proposer]))
    .digest("hex")
    .slice(0, 12);
  const path = localePath(loc, `/tasks/${t.id}`);
  return {
    id: t.id,
    locale: loc,
    title: clip(t.title, TITLE_MAX),
    fullTitle: t.title,
    summary,
    description,
    category,
    status: t.status,
    stage,
    stageLabel: STAGE[stage][zh ? 0 : 1],
    goal,
    pledged: totals.pledged,
    percent,
    backers: totals.backers,
    daysLeft,
    proposer,
    sharePrice: price,
    version,
    url: `${config.origin}${path}`,
    imageUrl: `${config.origin}/api/crowd/${t.id}/og?l=${loc}&v=${version}`,
    imageAlt: zh ? `${t.title}：SinoBee 眾籌，${progress}` : `${t.title}: a SinoBee crowdfund. ${progress}`,
  };
}

/** Open Graph, X card and canonical tags for a campaign page */
export async function crowdMetadata(id: string, locale: string): Promise<Metadata | null> {
  const s = await crowdShare(id, locale);
  if (!s) return null;
  const other = s.locale === "en" ? "zh_TW" : "en_US";
  const fb = config.crowd.facebookAppId;
  const site = config.crowd.xSite;
  return {
    title: s.title,
    description: s.description,
    alternates: { canonical: s.url, languages: { "zh-TW": `/tasks/${s.id}`, en: `/en/tasks/${s.id}` } },
    openGraph: {
      type: "website",
      siteName: "SinoBee.ai",
      locale: s.locale === "en" ? "en_US" : "zh_TW",
      alternateLocale: [other],
      url: s.url,
      title: s.title,
      description: s.description,
      images: [{ url: s.imageUrl, secureUrl: s.imageUrl, width: OG_SIZE.width, height: OG_SIZE.height, alt: s.imageAlt, type: "image/png" }],
    },
    twitter: { card: "summary_large_image", title: s.title, description: s.description, images: [{ url: s.imageUrl, alt: s.imageAlt }], ...(site ? { site } : {}) },
    ...(fb ? { facebook: { appId: fb } } : {}),
  };
}
