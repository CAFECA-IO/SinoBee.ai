import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { bearerAuth, currentUser, userFromSessionOrBearer } from "@/lib/auth";
import { loadShare, readDoc, revokeShare, shareJson, updateShare } from "@/lib/shares/service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const viewer = req.headers.get("authorization") ? (await bearerAuth(req))?.user ?? null : await currentUser();
  const { share, access } = await loadShare((await ctx.params).id, viewer);
  if (!access.ok || !share) return json({ error: access.ok ? "not found" : access.reason }, access.ok ? 404 : access.status);
  return json({ ...shareJson(share, config.origin), doc: await readDoc(share.objectKey) });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await userFromSessionOrBearer(req, "shares:write");
  const id = (await ctx.params).id;
  await updateShare(id, user, await req.json());
  return json(shareJson(await db.conversationShare.findUniqueOrThrow({ where: { id } }), config.origin));
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const user = await userFromSessionOrBearer(req, "shares:write");
  await revokeShare((await ctx.params).id, user);
  return json({ ok: true });
});
