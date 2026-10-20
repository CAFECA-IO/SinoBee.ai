import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { currentUser, userFromBearer } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import type { EvalTask } from "@/lib/bench-evals";
import { buildPage, isSha, outputKey, reportHashes, serveType, trialFiles } from "@/lib/eval-outputs";
import { getObject } from "@/lib/storage";

/**
 * A trial output of report <id> (design R2), for whoever may read the report (public, or its publisher):
 *   ?sha=<sha256>&path=<name>                      the file, as data (images as images, anything else as plain text)
 *   ?page=1&task=<input id>&trial=<n>&path=<html>  an HTML output as one page for <iframe sandbox="allow-scripts" srcdoc>
 * Only a hash the report lists as uploaded is served.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  const r = Number.isInteger(id) ? await db.benchEval.findUnique({ where: { id }, select: { data: true, hidden: true, visibility: true, publisherId: true } }) : null;
  if (!r || r.hidden) throw new HttpError(404, "not found");
  if (r.visibility !== "public") {
    const u = (await currentUser().catch(() => null)) ?? (await userFromBearer(req).catch(() => null));
    if (!u || u.id !== r.publisherId) throw new HttpError(404, "not found");
  }
  const tasks = ((r.data as { tasks?: EvalTask[] })?.tasks ?? []) as EvalTask[];
  const q = new URL(req.url).searchParams;
  const path = q.get("path") ?? "";
  if (q.get("page")) {
    const files = trialFiles(tasks, q.get("task") ?? "", Number(q.get("trial")));
    if (!files.has(path)) throw new HttpError(404, "not uploaded");
    const html = await buildPage(files, path);
    return json({ html }, { headers: { "Cache-Control": "private, max-age=300" } });
  }
  const sha = q.get("sha");
  if (!isSha(sha) || !reportHashes(tasks).has(sha)) throw new HttpError(404, "not found");
  const body = await getObject(outputKey(sha));
  const name = (path.split("/").pop() || sha.slice(0, 12)).replace(/[^\w.\-]+/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": serveType(path),
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${q.get("download") ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": r.visibility === "public" ? "public, max-age=86400, immutable" : "private, max-age=300",
    },
  });
});
