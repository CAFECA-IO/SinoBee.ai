import { z } from "zod";
import { handle, json } from "@/lib/http";
import { userFromSessionOrBearer } from "@/lib/auth";
import { PACK_MAX, deletePack, readPack, writePack } from "@/lib/vault";

type Ctx = { params: Promise<{ name: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  return json(await readPack(user.id, (await ctx.params).name));
});

export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  const body = z.object({ data: z.string().max(PACK_MAX), revision: z.number().int().min(0).optional() }).parse(await req.json());
  const p = await writePack(user.id, (await ctx.params).name, body.data, body.revision);
  return json({ ok: true, revision: p.revision, sha256: p.sha256 });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  return json({ ok: await deletePack(user.id, (await ctx.params).name) });
});
