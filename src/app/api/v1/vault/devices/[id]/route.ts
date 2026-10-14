import { z } from "zod";
import { handle, json } from "@/lib/http";
import { bearerAuth, requireBearer, userFromSessionOrBearer } from "@/lib/auth";
import { deleteDeviceKey, setDeviceKey } from "@/lib/vault";
import { HttpError } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };

/** A SinoBee with the vault unlocked seals the vault key to a device (`self` = the calling device) */
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { user, device } = await requireBearer(req, "vault:rw");
  let id = (await ctx.params).id;
  if (id === "self") {
    if (!device) throw new HttpError(400, "this token is not bound to a device");
    id = device.id;
  }
  const { wrapped } = z.object({ wrapped: z.string().max(4096) }).parse(await req.json());
  await setDeviceKey(user.id, id, wrapped);
  return json({ ok: true, deviceId: id });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  let id = (await ctx.params).id;
  if (id === "self") id = (await bearerAuth(req))?.device?.id ?? "";
  return json({ ok: await deleteDeviceKey(user.id, id) });
});
