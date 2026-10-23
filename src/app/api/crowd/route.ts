import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { BuyerInput } from "@/lib/buyer-schema";
import { DraftInput, buyProposalFee, createDraft, feeWaived } from "@/lib/crowd/proposal";

/**
 * Start a crowdfunding proposal (DRAFT) from a description. With `buyer` and `cardId` the proposal fee is charged to
 * that saved card in the same step; the model then drafts the spec. Subscribers pay no fee (payment: null, waived).
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await req.json();
  // the proposer must agree to the crowdfunding terms, including every screening item
  const input = DraftInput.extend({ agreeTerms: z.literal(true, { message: "agree to the crowdfunding terms first" }) }).parse(body);
  const task = await createDraft(user.id, input);
  // a declined card leaves the draft: the fee can be paid from the proposal page
  const waived = await feeWaived(user.id);
  const payment =
    !waived && body.buyer && typeof body.cardId === "string"
      ? await buyProposalFee(user.id, task.id, BuyerInput.parse(body.buyer), body.cardId).then((p) => ({ status: p.status }), (e) => ({ error: (e as Error).message }))
      : null;
  return json({ task: { id: task.id, status: task.status }, payment, waived });
});
