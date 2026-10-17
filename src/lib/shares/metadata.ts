import { db } from "../db";
import { config } from "../config";
import { previewable } from "./service";

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/**
 * Link previews (Open Graph, X cards) for LINK and PUBLIC shares: title, description and the 1200×630 picture
 * SinoBee made. Only PUBLIC shares may be indexed; LOGIN shares reveal nothing about themselves.
 */
export async function shareMetadata(id: string, path?: string) {
  const s = /^[A-Za-z0-9]{6,20}$/.test(id)
    ? await db.conversationShare.findUnique({ where: { id }, select: { title: true, description: true, visibility: true, revokedAt: true, expiresAt: true, ogKey: true, kind: true } }).catch(() => null)
    : null;
  if (!s || !previewable(s)) return { title: "SinoBee", robots: { index: false, follow: false } };
  const title = path ? `${path.split("/").pop()} · ${s.title}` : s.title;
  const description = s.description ?? undefined;
  const images = s.ogKey ? [{ url: `/api/shares/${id}/og`, width: 1200, height: 630, alt: s.title }] : ["/screenshots/usecase-research.png"];
  const url = `${config.origin}/s/${id}${path ? `/v/${encodePath(path)}` : ""}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", siteName: "SinoBee.ai", title, description, url, images },
    twitter: { card: s.ogKey ? "summary_large_image" : "summary", title, description, images: s.ogKey ? [`/api/shares/${id}/og`] : undefined },
    robots: s.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

