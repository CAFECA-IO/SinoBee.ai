import { handle, json } from "@/lib/http";
import { requireBearer } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { OUTPUT_MAX, isSha, storeOutput } from "@/lib/eval-outputs";

/**
 * One trial output from SinoBee, stored by its sha256 (evals:write), before the report that lists it is published.
 * The same file uploaded twice is stored once. Served only through a report that lists it (../[id]/outputs).
 */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ sha: string }> }) => {
  await requireBearer(req, "evals:write");
  const sha = (await ctx.params).sha;
  if (!isSha(sha)) throw new HttpError(400, "not a sha256");
  if (Number(req.headers.get("content-length") ?? 0) > OUTPUT_MAX) return json({ error: "file too large" }, 413);
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > OUTPUT_MAX) return json({ error: "file too large" }, 413);
  await storeOutput(sha, body);
  return json({ sha256: sha, bytes: body.length }, 201);
});
