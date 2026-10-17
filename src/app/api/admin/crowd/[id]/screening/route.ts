import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { rerunScreening } from "@/lib/crowd/screening";

const Input = z.object({ note: z.string().max(2000).optional() });

/** Ask for a re-review (optionally with a note the AI reads as context); the checklist result still decides */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { note } = Input.parse(await req.json().catch(() => ({})));
  await rerunScreening(admin.id, (await ctx.params).id, note);
  return json({ ok: true });
});
