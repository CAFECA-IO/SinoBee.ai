import { db } from "@/lib/db";

/** The exact markdown of one legal document version (what the Boltchain certificate notarizes) */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const row = await db.legalVersion.findUnique({ where: { id: (await ctx.params).id } });
  if (!row) return new Response("not found", { status: 404 });
  return new Response(row.markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `inline; filename="sinobee-${row.doc}-${row.locale}-v${row.version}.md"`,
      "x-content-sha256": row.sha256,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
