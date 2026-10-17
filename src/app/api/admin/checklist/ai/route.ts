import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { editDraftWithAi } from "@/lib/crowd/checklist";

/** Change the draft by describing the change to a model (saved as the draft, not published) */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const { instruction } = z.object({ instruction: z.string().trim().min(1).max(4000) }).parse(await req.json());
  return json(await editDraftWithAi(admin.id, instruction));
});
