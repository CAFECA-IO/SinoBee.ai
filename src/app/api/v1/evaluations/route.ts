import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { requireBearer } from "@/lib/auth";
import { createStudy } from "@/lib/evaluations";

/** Published evaluation studies (newest first) */
export const GET = handle(async (req: Request) => {
  const kind = new URL(req.url).searchParams.get("kind");
  const rows = await db.evaluationStudy.findMany({
    where: { hidden: false, ...(kind === "model" || kind === "skill" ? { kind } : {}) },
    orderBy: { testedAt: "desc" },
    take: 100,
    select: { id: true, kind: true, title: true, domain: true, skill: true, summary: true, judgeModel: true, testedAt: true, models: true, bestModel: true, bestScore: true },
  });
  return json({ items: rows.map((r) => ({ ...r, models: r.models.split(",").filter(Boolean), url: `${config.origin}/benchmarks/studies/${r.id}` })) });
});

/** Publish a study from SinoBee (`sinobee eval publish`; token scope evals:write) */
export const POST = handle(async (req: Request) => {
  const { user } = await requireBearer(req, "evals:write");
  if (Number(req.headers.get("content-length") ?? 0) > 4 * 1024 * 1024) return json({ error: "report too large" }, 413);
  const s = await createStudy(user, await req.json());
  return json({ id: s.id, url: `${config.origin}/benchmarks/studies/${s.id}` }, 201);
});
