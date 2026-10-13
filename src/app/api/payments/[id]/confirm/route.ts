import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { confirmPayment } from "@/lib/payments";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { txHash } = z.object({ txHash: z.string().optional() }).parse(await req.json().catch(() => ({})));
  const p = await confirmPayment(user.id, (await ctx.params).id, txHash);
  return json({ id: p.id, status: p.status, txHash: p.txHash });
});
