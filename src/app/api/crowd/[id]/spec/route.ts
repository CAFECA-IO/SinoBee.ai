import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { saveSpec } from "@/lib/crowd/proposal";
import { specTurn } from "@/lib/crowd/spec-agent";

/** One turn of the spec dialogue (charged to the proposal credit) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { message } = z.object({ message: z.string().trim().min(1).max(8000) }).parse(await req.json());
  return json(await specTurn(user.id, (await ctx.params).id, message));
});

/** The proposer edits the spec by hand */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { spec } = z.object({ spec: z.record(z.string(), z.unknown()) }).parse(await req.json());
  return json({ spec: await saveSpec(user.id, (await ctx.params).id, spec) });
});
