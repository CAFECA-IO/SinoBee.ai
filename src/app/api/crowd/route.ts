import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { DraftInput, createDraft } from "@/lib/crowd/proposal";

/** Start a crowdfunding proposal (DRAFT); next: pay the proposal fee, then the spec dialogue */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const task = await createDraft(user.id, DraftInput.parse(await req.json()));
  return json({ task: { id: task.id, status: task.status } });
});
