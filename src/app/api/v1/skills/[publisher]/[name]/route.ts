import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { LISTED, skillDetailJson } from "@/lib/skills/api";
import { compareVersions } from "@/lib/skills/spec";

/** Hub API v1 detail — versions newest first */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ publisher: string; name: string }> }) => {
  const { publisher, name } = await ctx.params;
  const s = await db.skill.findFirst({
    where: { name, publisher: { publisher } },
    include: { publisher: true, tags: true, versions: { where: LISTED } },
  });
  if (!s || !s.versions.length) return json({ error: "not found" }, 404);
  s.versions.sort((a, b) => compareVersions(b.version, a.version));
  return json(skillDetailJson(s));
});
