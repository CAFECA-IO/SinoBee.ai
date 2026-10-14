import { handle, json } from "@/lib/http";
import { userFromSessionOrBearer } from "@/lib/auth";
import { getVaultKey, setVaultKey, vaultKeyBody } from "@/lib/vault";

export const GET = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  const k = await getVaultKey(user.id);
  return k ? json({ publicKey: k.publicKey, wrapped: k.wrapped, updated_at: k.updatedAt }) : json({ error: "no vault yet" }, 404);
});

export const PUT = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  const k = await setVaultKey(user.id, vaultKeyBody.parse(await req.json()));
  return json({ ok: true, publicKey: k.publicKey });
});
