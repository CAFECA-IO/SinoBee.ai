import { llmAuth, errorResponse } from "@/lib/llm/relay";
import * as streams from "@/lib/llm/streams";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Resume a relay stream that was sent with `x-sinobee-request-id` (streams.ts): the events after `Last-Event-ID`
 * (or ?after=n), then the rest as it comes, with ": ping" heartbeats. Kept 15 minutes; only for the same user.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await llmAuth(req);
    const id = streams.validRequestId((await ctx.params).id);
    if (!id) throw new HttpError(400, "bad request id");
    const src = await streams.find(user.id, id);
    if (!src) throw new HttpError(404, "no such stream (finished more than 15 minutes ago, or never started)");
    const after = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after")) || 0;
    return streams.sseResponse(src, { after, ids: true, headers: { "x-sinobee-request-id": id } });
  } catch (e) {
    return errorResponse("openai", e);
  }
}
