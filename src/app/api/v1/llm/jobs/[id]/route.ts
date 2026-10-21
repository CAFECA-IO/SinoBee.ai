import { llmAuth, errorResponse } from "@/lib/llm/relay";
import * as streams from "@/lib/llm/streams";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * A background relay call's events after `after` (SSE text blocks, the same as the stream would carry), waiting up
 * to `wait` seconds (default 20, at most 25) for new ones: {id, status: running|done|error, events, next, error}.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await llmAuth(req);
    const id = streams.validRequestId((await ctx.params).id);
    if (!id) throw new HttpError(400, "bad job id");
    const src = await streams.find(user.id, id);
    if (!src) throw new HttpError(404, "no such job (finished more than 15 minutes ago, or never started)");
    const q = new URL(req.url).searchParams;
    const after = Math.max(0, Number(q.get("after")) || 0);
    const wait = q.has("wait") ? Number(q.get("wait")) * 1000 : 20_000;
    return Response.json({ id, ...(await streams.poll(src, after, wait)) });
  } catch (e) {
    return errorResponse("openai", e);
  }
}
