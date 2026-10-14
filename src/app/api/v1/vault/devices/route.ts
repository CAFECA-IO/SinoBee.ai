import { handle, json } from "@/lib/http";
import { bearerAuth, userFromSessionOrBearer } from "@/lib/auth";
import { vaultDevices } from "@/lib/vault";

/** The user's signed-in SinoBee installs and whether each holds a copy of the vault key */
export const GET = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  const device = req.headers.get("authorization") ? (await bearerAuth(req))?.device : null;
  return json({ items: await vaultDevices(user.id, device?.id) });
});
