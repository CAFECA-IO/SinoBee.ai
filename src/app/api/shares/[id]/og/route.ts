import { db } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { previewable } from "@/lib/shares/service";
import { thumbMime } from "@/lib/shares/service";

/**
 * The share's link-preview picture (Open Graph / X card). Crawlers fetch it without signing in, so it is served
 * only for LINK and PUBLIC shares that are still live; LOGIN shares never reveal anything about themselves.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9]{6,20}$/.test(id)) return new Response("not found", { status: 404 });
  const s = await db.conversationShare.findUnique({ where: { id }, select: { visibility: true, revokedAt: true, expiresAt: true, ogKey: true } });
  if (!s || !s.ogKey || !previewable(s)) return new Response("not found", { status: 404 });
  const body = await getObject(s.ogKey).catch(() => null);
  const mime = body ? thumbMime(body) : null;
  if (!body || !mime) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": mime,
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
