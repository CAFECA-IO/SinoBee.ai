import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { getObject } from "@/lib/storage";
import { checkCap } from "@/lib/shares/view-cap";

/**
 * Files of a shared document (a report's images, an interactive page and its scripts), for the share page and the
 * sandboxed frame it opens: /api/shares/<id>/raw/<cap>/<path inside the share>.
 * HTML and SVG run only inside the sandbox (opaque origin: no cookies, no access to sinobee.ai, network limited to
 * this share's own files); opened directly in a tab they go to the share page instead.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await ctx.params;
  const [cap, ...rest] = path ?? [];
  if (!/^[A-Za-z0-9]{6,20}$/.test(id) || !cap || !rest.length || !checkCap(id, cap)) return new Response("not found", { status: 404 });
  const name = rest.map((p) => decodeURIComponent(p)).join("/");
  const share = await db.conversationShare.findUnique({ where: { id }, select: { revokedAt: true, expiresAt: true, files: { where: { name }, take: 1 } } });
  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt < new Date())) return new Response("gone", { status: 410 });
  const f = share.files[0];
  if (!f) return new Response("not found", { status: 404 });
  const page = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml)$/.test(f.mime);
  if (page && req.headers.get("sec-fetch-dest") === "document") return new Response(null, { status: 302, headers: { location: `/s/${id}` } });
  // the share's own folder, by the public origin and by the host this request came to (they differ behind a proxy)
  const here = `/api/shares/${id}/raw/${cap}/`;
  const base = [...new Set([config.origin, new URL(req.url).origin])].map((o) => `${o}${here}`).join(" ");
  const csp = page
    ? "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads; " +
      `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${base} https: blob:; style-src 'unsafe-inline' ${base} https:; ` +
      `img-src ${base} data: blob: https:; font-src ${base} data: https:; media-src ${base} data: blob: https:; connect-src ${base}; ` +
      `worker-src ${base} blob:; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`
    : "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  const body = await getObject(f.objectKey);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": /^text\/|javascript|json|svg|xml/.test(f.mime) ? `${f.mime}; charset=utf-8` : f.mime,
      "content-security-policy": csp,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      // the sandboxed frame has an opaque origin: its subresource requests are cross-origin
      "cross-origin-resource-policy": "cross-origin",
      "cache-control": "private, max-age=3600",
    },
  });
}
