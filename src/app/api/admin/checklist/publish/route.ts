import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { publishDraft } from "@/lib/crowd/checklist";

/** Publish the draft as the next public version (crowdfunding terms are updated and notarized) */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const { note } = z.object({ note: z.string().trim().min(1).max(2000) }).parse(await req.json());
  const r = await publishDraft(admin.id, note);
  return json({ version: r.version, items: r.items.length });
});
