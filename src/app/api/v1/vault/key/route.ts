import { handle, json } from "@/lib/http";
import { bearerAuth, userFromSessionOrBearer } from "@/lib/auth";
import { deviceWrapped, getVaultKey, setVaultKey, vaultKeyBody } from "@/lib/vault";

/** The wrapped vault key; a signed-in SinoBee also gets its own device copy (no passphrase needed) */
export const GET = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  const k = await getVaultKey(user.id);
  if (!k) return json({ error: "no vault yet" }, 404);
  const device = req.headers.get("authorization") ? (await bearerAuth(req))?.device : null;
  return json({ publicKey: k.publicKey, wrapped: k.wrapped, deviceWrapped: await deviceWrapped(device?.id), deviceId: device?.id ?? null, updated_at: k.updatedAt });
});

export const PUT = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  const k = await setVaultKey(user.id, vaultKeyBody.parse(await req.json()));
  return json({ ok: true, publicKey: k.publicKey });
});
