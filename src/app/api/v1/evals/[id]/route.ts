import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";

/** One evaluation with all its trials (the data the report page is drawn from) */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  const r = Number.isInteger(id) ? await db.benchEval.findUnique({ where: { id }, include: { publisher: { select: { publisher: true, handle: true } } } }) : null;
  if (!r || r.hidden) return json({ error: "not found" }, 404);
  const { publisherId: _p, ...rest } = r;
  void _p;
  return json(rest);
});
