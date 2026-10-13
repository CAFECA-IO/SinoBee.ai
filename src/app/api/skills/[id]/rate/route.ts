import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { rateSkill } from "@/lib/skills/service";
import { db } from "@/lib/db";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { stars } = z.object({ stars: z.number().int().min(1).max(5) }).parse(await req.json());
  await rateSkill(user.id, id, stars);
  const s = await db.skill.findUniqueOrThrow({ where: { id } });
  return json({ ratingAvg: s.ratingAvg, ratingCount: s.ratingCount, mine: stars });
});
