import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { completeMockBinding } from "@/lib/crowd/cards";

/** Development card binding (PAYMENT_MODE=mock, never in production) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { ok, decline } = z.object({ ok: z.boolean(), decline: z.boolean().default(false) }).parse(await req.json());
  return json(await completeMockBinding(user.id, (await ctx.params).id, ok, decline ? "decline" : "ok"));
});
