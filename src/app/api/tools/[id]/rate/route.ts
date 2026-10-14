import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { rateTool } from "@/lib/tools/service";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { stars } = z.object({ stars: z.number().int().min(1).max(5) }).parse(await req.json());
  const t = await rateTool(user, (await ctx.params).id, stars);
  return json({ ratingAvg: t.ratingAvg, ratingCount: t.ratingCount, mine: stars });
});
