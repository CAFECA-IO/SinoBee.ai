import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { BuyerInput } from "@/lib/buyer-schema";
import { DraftInput, buyProposalFee, createDraft } from "@/lib/crowd/proposal";

/**
 * Start a crowdfunding proposal (DRAFT) from a description. With `buyer` the proposal fee checkout is created in the
 * same step; once it is paid the model drafts the spec.
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await req.json();
  // the proposer must agree to the crowdfunding terms, including every screening item
  const input = DraftInput.extend({ agreeTerms: z.literal(true, { message: "agree to the crowdfunding terms first" }) }).parse(body);
  const task = await createDraft(user.id, input);
  // a checkout failure leaves the draft: the fee can be paid from the proposal page
  const payment = body.buyer ? await buyProposalFee(user.id, task.id, BuyerInput.parse(body.buyer)).catch((e) => ({ error: (e as Error).message })) : null;
  return json({ task: { id: task.id, status: task.status }, payment });
});
