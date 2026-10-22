import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { RESET_WINDOWS, resetWindows } from "@/lib/llm/quota";

/** Give a user's 6-hour window, current week or both back in full (audited) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const b = z.object({ window: z.enum(RESET_WINDOWS), reason: z.string().trim().max(500).optional() }).parse(await req.json());
  return json({ ok: true, ...(await resetWindows(admin.id, (await ctx.params).id, b.window, b.reason)) });
});
