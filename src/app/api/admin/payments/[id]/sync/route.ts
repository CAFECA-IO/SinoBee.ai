import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { syncPayment } from "@/lib/payments";

/** Re-read a payment from Oen now */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const p = await syncPayment((await ctx.params).id);
  return json({ id: p.id, status: p.status, providerStatus: p.providerStatus });
});
