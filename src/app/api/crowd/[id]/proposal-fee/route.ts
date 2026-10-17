import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { BuyerInput } from "@/lib/buyer-schema";
import { buyProposalFee } from "@/lib/crowd/proposal";

/** Checkout for one proposal fee (non-refundable credit for the spec dialogue and storage) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { buyer } = z.object({ buyer: BuyerInput }).parse(await req.json());
  const payment = await buyProposalFee(user.id, (await ctx.params).id, buyer);
  return json({ payment });
});
