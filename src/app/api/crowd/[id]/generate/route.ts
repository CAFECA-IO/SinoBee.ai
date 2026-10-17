import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { specProgress, startGenerate } from "@/lib/crowd/spec-agent";

/**
 * The model drafts the whole proposal from the description (once, after the proposal fee is paid). It runs in the
 * background: a long model call would otherwise outlast the proxies in front of the site (HTTP 502).
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  return json(await startGenerate(user.id, (await ctx.params).id));
});

/** Progress of the background job (drafting or a dialogue turn) */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  return json(await specProgress(user.id, (await ctx.params).id));
});
