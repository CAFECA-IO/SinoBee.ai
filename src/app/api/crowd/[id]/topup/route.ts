import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { openTopup } from "@/lib/crowd/lifecycle";

/** The proposer opens a top-up round after the budget ran out */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { goalTwd } = z.object({ goalTwd: z.coerce.number().int().positive() }).parse(await req.json());
  await openTopup(user.id, (await ctx.params).id, goalTwd);
  return json({ ok: true });
});
