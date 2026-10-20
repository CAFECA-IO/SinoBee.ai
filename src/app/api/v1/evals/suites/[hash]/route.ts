import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";

/** A shared suite with its test inputs, so SinoBee can run it (`suite:<hash>`) and readers can check it */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ hash: string }> }) => {
  const hash = (await ctx.params).hash;
  const s = /^[0-9a-f]{64}$/.test(hash) ? await db.benchSuite.findUnique({ where: { hash } }) : null;
  if (!s || s.hidden) return json({ error: "not found" }, 404);
  return json({
    hash: s.hash, skill: s.subject, skill_version: s.subjectVersion, evaluator: s.evaluator, evaluator_version: s.evaluatorVersion,
    title: s.title, suite: s.suite, inputs: s.inputs, reports: s.reportCount, created_at: s.createdAt.toISOString(),
  });
});
