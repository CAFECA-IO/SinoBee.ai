import { z } from "zod";
import { handle, json } from "@/lib/http";
import { bearerAuth, currentUser, userFromSessionOrBearer } from "@/lib/auth";
import { deleteTool, findTool, setVisibility, toolJson } from "@/lib/tools/service";
import { compareVersions } from "@/lib/skills/spec";

type Ctx = { params: Promise<{ owner: string; name: string }> };

async function viewer(req: Request) {
  if (req.headers.get("authorization")) return (await bearerAuth(req))?.user ?? null;
  return currentUser();
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { owner, name } = await ctx.params;
  const want = new URL(req.url).searchParams.get("version");
  const { tool, versions, isOwner } = await findTool(await viewer(req), owner, name);
  const sorted = [...versions].sort((a, b) => compareVersions(b.version, a.version));
  const v = want ? sorted.find((x) => x.version === want) : sorted[0];
  if (!v) return json({ error: "version not found" }, 404);
  return json({ ...toolJson(tool, v, { owner: isOwner }), latest: sorted[0].version, versions: sorted.map((x) => ({ version: x.version, status: x.status, published_at: x.publishedAt.toISOString() })) });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await userFromSessionOrBearer(req, "tools:write");
  const { name } = await ctx.params;
  const { visibility } = z.object({ visibility: z.enum(["PRIVATE", "PUBLIC"]) }).parse(await req.json());
  await setVisibility(user, name, visibility);
  return json({ ok: true });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const user = await userFromSessionOrBearer(req, "tools:write");
  await deleteTool(user, (await ctx.params).name);
  return json({ ok: true });
});
