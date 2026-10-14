import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { bearerAuth } from "@/lib/auth";
import { findTool } from "@/lib/tools/service";

/** Counts an install (SinoBee calls this after adding the tool locally) */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) => {
  const { owner, name } = await ctx.params;
  const a = await bearerAuth(req);
  const { tool, isOwner } = await findTool(a?.user ?? null, owner, name);
  if (!isOwner) await db.tool.update({ where: { id: tool.id }, data: { installs: { increment: 1 } } });
  return json({ ok: true });
});
