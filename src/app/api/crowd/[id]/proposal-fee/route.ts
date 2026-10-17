import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { BuyerInput } from "@/lib/buyer-schema";
import { buyProposalFee } from "@/lib/crowd/proposal";

/** Charge one proposal fee to a saved card (non-refundable credit for the spec model and storage) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { buyer, cardId } = z.object({ buyer: BuyerInput, cardId: z.string().max(40) }).parse(await req.json());
  const payment = await buyProposalFee(user.id, (await ctx.params).id, buyer, cardId);
  return json({ payment: { id: payment.id, status: payment.status } });
});
