import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { userFromSessionOrBearer } from "@/lib/auth";
import { toolJson } from "@/lib/tools/service";

/** The caller's own tools (private and public), latest version each */
export const GET = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "tools:write");
  const rows = await db.tool.findMany({ where: { ownerId: user.id }, include: { owner: true, versions: { orderBy: { publishedAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } });
  return json({ items: rows.map((t) => toolJson(t, t.versions[0], { owner: true })) });
});
