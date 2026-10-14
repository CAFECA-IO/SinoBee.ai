import { currentUser } from "@/lib/auth";
import { getObject } from "@/lib/storage";
import { loadShare } from "@/lib/shares/service";

/** A file attached to a share; same access rules as the page */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await ctx.params;
  const { share, access } = await loadShare(id, await currentUser());
  if (!share || !access.ok) return new Response("not found", { status: access.ok ? 404 : access.status });
  const f = share.files.find((x) => x.objectKey === `shares/${id}/files/${fid}`);
  if (!f) return new Response("not found", { status: 404 });
  const body = await getObject(f.objectKey);
  const inline = /^image\/(png|jpe?g|gif|webp)$/.test(f.mime);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": f.mime,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(f.name)}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
