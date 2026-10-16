import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { refundPayment } from "@/lib/payments";

/** Refund a payment through Oen (one refund per transaction; omit amount for the full refundable amount) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const b = z.object({ amount: z.coerce.number().int().positive().optional(), reason: z.string().trim().max(200).optional() }).parse(await req.json());
  const p = await refundPayment(admin.id, (await ctx.params).id, b);
  return json({ id: p.id, status: p.status, refundedTwd: p.refundedTwd });
});
