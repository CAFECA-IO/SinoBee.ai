import { z } from "zod";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { userFromBearer, userFromSessionOrBearer } from "@/lib/auth";
import { setVisibility } from "@/lib/bench-evals";

/** One evaluation with all its trials (the data the report page is drawn from); a private one only for its publisher */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  const r = Number.isInteger(id) ? await db.benchEval.findUnique({ where: { id }, include: { publisher: { select: { publisher: true, handle: true } } } }) : null;
  if (!r || r.hidden) return json({ error: "not found" }, 404);
  if (r.visibility !== "public") {
    const u = await userFromBearer(req).catch(() => null);
    if (!u || u.id !== r.publisherId) return json({ error: "not found" }, 404);
  }
  const { publisherId: _p, ...rest } = r;
  void _p;
  return json(rest);
});

/** Make a report public or private: its publisher, from SinoBee (evals:write) or the report page */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await userFromSessionOrBearer(req, "evals:write");
  const id = Number((await ctx.params).id);
  const b = z.object({ visibility: z.enum(["public", "private"]) }).parse(await req.json());
  const r = await setVisibility(user, id, b.visibility);
  return json({ id: r.id, visibility: r.visibility });
});
