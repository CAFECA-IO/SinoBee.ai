import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { downloadUrl, getObject } from "@/lib/storage";
import { s3CostUsd } from "@/lib/pricing";
import { canDownload } from "@/lib/tasks/service";

/**
 * Results are downloadable by the requester only — and, for crowdfunded tasks, by every backer whose pledge was
 * collected (public tasks show summaries, not files),
 * and only until the artifact's expiry (7 days after completion for non-subscribers).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; artifactId: string }> }) {
  const { id, artifactId } = await ctx.params;
  const u = await currentUser();
  if (!u) return new Response("unauthorized", { status: 401 });
  const a = await db.artifact.findUnique({ where: { id: artifactId }, include: { task: true } });
  if (!a || a.taskId !== id || !(await canDownload(a.task, u.id))) return new Response("not found", { status: 404 });
  if (a.deletedAt || (a.expiresAt && a.expiresAt < new Date()))
    return new Response("The download window for this result has ended (results are kept 7 days after completion).", { status: 410 });
  // GET request fees are included in the S3 estimate billed at upload; track extra downloads for audit only
  await db.taskEvent.create({ data: { taskId: id, type: "download", message: `Downloaded ${a.filename}`, data: { s3GetUsd: s3CostUsd(0, 0, 0, 1), by: u.id } } });
  const url = await downloadUrl(a.key, a.filename);
  if (url) return Response.redirect(url, 302);
  const body = await getObject(a.key);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${a.filename}"`,
      "content-length": String(body.length),
      "cache-control": "private, no-store",
    },
  });
}
