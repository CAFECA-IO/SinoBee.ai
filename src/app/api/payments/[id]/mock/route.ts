import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { completeMockPayment } from "@/lib/payments";

/** Development checkout (PAYMENT_MODE=mock, never in production) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { ok } = z.object({ ok: z.boolean() }).parse(await req.json());
  const p = await completeMockPayment(user.id, (await ctx.params).id, ok);
  return json({ id: p.id, status: p.status });
});
