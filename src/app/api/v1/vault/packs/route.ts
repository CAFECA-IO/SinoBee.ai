import { handle, json } from "@/lib/http";
import { userFromSessionOrBearer } from "@/lib/auth";
import { listPacks } from "@/lib/vault";

export const GET = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "vault:rw");
  return json({ items: (await listPacks(user.id)).map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })) });
});
