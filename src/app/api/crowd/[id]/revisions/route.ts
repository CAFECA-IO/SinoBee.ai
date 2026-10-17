import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { reviseSpec } from "@/lib/crowd/proposal";

/** Publish a new spec version while the campaign is open (backers may withdraw during the exit window) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { spec, note } = z.object({ spec: z.record(z.string(), z.unknown()), note: z.string().trim().min(1).max(2000) }).parse(await req.json());
  const t = await reviseSpec(user.id, (await ctx.params).id, spec, note);
  return json({ version: t.specVersion, exitUntil: t.exitUntil });
});
