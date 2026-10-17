import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { discardDraft, saveDraft } from "@/lib/crowd/checklist";

/** Save the checklist draft (manual edits) */
export const PUT = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const { items } = z.object({ items: z.array(z.unknown()).max(500) }).parse(await req.json());
  return json({ items: await saveDraft(admin.id, items) });
});

/** Throw the draft away (back to the published version) */
export const DELETE = handle(async () => {
  await requireAdmin();
  await discardDraft();
  return json({ ok: true });
});
