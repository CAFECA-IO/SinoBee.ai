import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { DraftInput, createDraft } from "@/lib/crowd/proposal";

/** Start a crowdfunding proposal (DRAFT); next: pay the proposal fee, then the spec dialogue */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  // the proposer must agree to the crowdfunding terms, including every screening item
  const input = DraftInput.extend({ agreeTerms: z.literal(true, { message: "agree to the crowdfunding terms first" }) }).parse(await req.json());
  const task = await createDraft(user.id, input);
  return json({ task: { id: task.id, status: task.status } });
});
