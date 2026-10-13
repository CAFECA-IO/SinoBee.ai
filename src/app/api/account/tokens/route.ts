import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { randomToken, sha256Hex } from "@/lib/crypto";

/** Create a Hub API token (shown once) for `sinobee keys set sinobee-hub` */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(await req.json());
  if ((await db.apiToken.count({ where: { userId: user.id, revokedAt: null } })) >= 10) return json({ error: "too many tokens" }, 400);
  const token = `sbh_${randomToken(30)}`;
  await db.apiToken.create({ data: { userId: user.id, name, prefix: token.slice(0, 10), tokenHash: sha256Hex(token) } });
  return json({ token });
});

export const DELETE = handle(async (req: Request) => {
  const user = await requireUser();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  await db.apiToken.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  return json({ ok: true });
});
