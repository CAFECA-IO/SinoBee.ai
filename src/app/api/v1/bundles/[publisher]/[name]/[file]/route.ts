import { db } from "@/lib/db";
import { downloadUrl, getObject } from "@/lib/storage";

/** Bundle download (.tar.gz with a single <name>/ folder + .sinobee-manifest.json) */
export async function GET(_req: Request, ctx: { params: Promise<{ publisher: string; name: string; file: string }> }) {
  const { publisher, name, file } = await ctx.params;
  const m = /^(.+)\.tar\.gz$/.exec(file);
  if (!m) return new Response("not found", { status: 404 });
  const v = await db.skillVersion.findFirst({
    where: { version: m[1], skill: { name, publisher: { publisher } } },
    include: { skill: true },
  });
  if (!v || v.status === "REJECTED") return new Response("not found", { status: 404 });
  if (v.status === "REVOKED") return new Response("this version has been revoked", { status: 410 });
  await db.$transaction([
    db.skillVersion.update({ where: { id: v.id }, data: { downloads: { increment: 1 } } }),
    db.skill.update({ where: { id: v.skillId }, data: { downloads: { increment: 1 } } }),
  ]);
  const filename = `${name}-${v.version}.tar.gz`;
  const url = await downloadUrl(v.bundleKey, filename);
  if (url) return Response.redirect(url, 302);
  const body = await getObject(v.bundleKey);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-hash": v.contentHash,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
