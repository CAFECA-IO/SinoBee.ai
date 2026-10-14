import { bearerAuth, currentUser } from "@/lib/auth";
import { getObject } from "@/lib/storage";
import { loadShare } from "@/lib/shares/service";

/** A file attached to a share; same access rules as the page */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await ctx.params;
  // the website (cookie) or SinoBee importing a share (Bearer)
  const viewer = _req.headers.get("authorization") ? (await bearerAuth(_req))?.user ?? null : await currentUser();
  const { share, access } = await loadShare(id, viewer);
  if (!share || !access.ok) return new Response("not found", { status: access.ok ? 404 : access.status });
  const f = share.files.find((x) => x.objectKey === `shares/${id}/files/${fid}`);
  if (!f) return new Response("not found", { status: 404 });
  const body = await getObject(f.objectKey);
  const inline = /^(image\/(png|jpe?g|gif|webp)|video\/(mp4|webm|ogg|quicktime)|audio\/)/.test(f.mime);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": f.mime,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(f.name)}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      "accept-ranges": "none",
    },
  });
}
