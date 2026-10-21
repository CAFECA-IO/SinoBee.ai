import { llmAuth, errorResponse } from "@/lib/llm/relay";
import { route } from "@/lib/llm/route";

export const dynamic = "force-dynamic";

/**
 * Which model SinoBee should use for this turn and role (plan P4): {role, preference, skill, task_kind, needs,
 * candidates?} → {model, format, reason, preference, ttl, ranking}. Nothing about the request is stored.
 * SinoBee does not ask while the user has pinned a model.
 */
export async function POST(req: Request) {
  try {
    const { user } = await llmAuth(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json(await route(body, user.id));
  } catch (e) {
    return errorResponse("openai", e);
  }
}
