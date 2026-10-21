import { llmAuth, errorResponse } from "@/lib/llm/relay";
import { recordStats } from "@/lib/llm/route";

export const dynamic = "force-dynamic";

/**
 * Anonymous task outcomes (plan P5). SinoBee sends them only when the user turned "回報匿名統計" on (off by
 * default). Stored without the user, the session or any content: day, model, kind of task, a published skill's
 * name, outcome and numbers. They feed the completion rate in model allocation.
 */
export async function POST(req: Request) {
  try {
    await llmAuth(req);
    const body = (await req.json().catch(() => ({}))) as { items?: unknown };
    return Response.json(await recordStats(body.items));
  } catch (e) {
    return errorResponse("openai", e);
  }
}
