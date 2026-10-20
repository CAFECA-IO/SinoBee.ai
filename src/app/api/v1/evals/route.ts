import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { requireBearer } from "@/lib/auth";
import { createEval, PUBLIC } from "@/lib/bench-evals";

const COLS = {
  id: true, kind: true, subject: true, subjectVersion: true, title: true, suite: true, suiteHash: true, thinkingModel: true, executionModel: true,
  judgeModel: true, trials: true, meanScore: true, stdErr: true, fairScore: true, qualified: true, critFails: true, medianSeconds: true,
  costPerPass: true, creativityWins: true, creativityTotal: true, testedAt: true, evaluator: true,
} as const;

/** Published (public) evaluations, newest first; ?kind=skill|model&subject=…&suite_hash=… */
export const GET = handle(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind");
  const subject = q.get("subject");
  const suiteHash = q.get("suite_hash");
  const rows = await db.benchEval.findMany({
    where: { ...PUBLIC, ...(kind === "model" || kind === "skill" ? { kind } : {}), ...(subject ? { subject } : {}), ...(suiteHash ? { suiteHash } : {}) },
    orderBy: { testedAt: "desc" },
    take: 200,
    select: COLS,
  });
  return json({ items: rows.map((r) => ({ ...r, url: `${config.origin}/benchmarks/evals/${r.id}` })) });
});

/** Publish one evaluation from SinoBee (`sinobee eval publish`; token scope evals:write) */
export const POST = handle(async (req: Request) => {
  const { user } = await requireBearer(req, "evals:write");
  if (Number(req.headers.get("content-length") ?? 0) > 4 * 1024 * 1024) return json({ error: "report too large" }, 413);
  const r = await createEval(user, await req.json());
  return json({ id: r.id, url: `${config.origin}/benchmarks/evals/${r.id}` }, 201);
});
