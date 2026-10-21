import { relay, errorResponse } from "@/lib/llm/relay";
import * as streams from "@/lib/llm/streams";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Start a relay call in the background (streams.ts): the same body as POST /api/v1/llm/anthropic/v1/messages
 * (?format=anthropic) or /api/v1/llm/chat/completions (?format=openai), answered at once with 202 {id}. The events
 * are read with GET /api/v1/llm/jobs/{id}?after=n - every request is short, so no proxy limit applies to a long
 * answer. `x-sinobee-request-id` names the job (else one is made); the same id again joins the running job.
 */
export async function POST(req: Request) {
  const format = new URL(req.url).searchParams.get("format") === "openai" ? "openai" : "anthropic";
  try {
    const given = req.headers.get("x-sinobee-request-id");
    const requestId = given ? streams.validRequestId(given) : streams.newJobId();
    if (!requestId) throw new HttpError(400, "bad request id");
    return await relay(req, format, format === "openai" ? "chat" : "messages", { requestId, detach: true });
  } catch (e) {
    return errorResponse(format, e);
  }
}
