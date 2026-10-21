import { errorResponse } from "@/lib/llm/relay";
import { boardFor } from "@/lib/llm/route";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** For SinoBee's settings: each of the user's models with its public evaluation facts and the preferences that would
 * pick it (?models=vendor/model,...&skill=). Public data only; nothing is stored. */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const models = (u.searchParams.get("models") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
    if (!models.length) throw new HttpError(400, "models is required");
    return Response.json({ models: await boardFor(models, u.searchParams.get("skill")) });
  } catch (e) {
    return errorResponse("openai", e);
  }
}
