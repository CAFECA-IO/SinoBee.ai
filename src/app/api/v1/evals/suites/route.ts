import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { requireBearer } from "@/lib/auth";
import { createSuite, SUITE_LIST, suiteSummary } from "@/lib/bench-suites";

/** Shared evaluation suites of a skill (most used first): ?skill=<name>[&version=] (or publisher/name) */
export const GET = handle(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const skill = (q.get("skill") ?? "").split("/").pop() ?? "";
  const version = q.get("version");
  if (!skill) return json({ error: "skill is required" }, 400);
  const rows = await db.benchSuite.findMany({
    where: { hidden: false, subject: skill },
    orderBy: [{ reportCount: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: { ...SUITE_LIST, suite: true, inputs: true },
  });
  return json({
    items: rows.map(({ suite, inputs, createdBy, ...r }) => ({
      ...r, ...suiteSummary({ suite, inputs }), same_version: !version || r.subjectVersion === version,
      by: createdBy.publisher ?? createdBy.handle ?? createdBy.account.slice(0, 10),
      url: `${config.origin}/api/v1/evals/suites/${r.hash}`,
    })),
  });
});

/** Share a suite (SinoBee publishes it before its public reports; token scope evals:write). The hash is recomputed. */
export const POST = handle(async (req: Request) => {
  const { user } = await requireBearer(req, "evals:write");
  if (Number(req.headers.get("content-length") ?? 0) > 4 * 1024 * 1024) return json({ error: "suite too large" }, 413);
  const s = await createSuite(user, await req.json());
  return json({ id: s.id, hash: s.hash, url: `${config.origin}/api/v1/evals/suites/${s.hash}` }, 201);
});
