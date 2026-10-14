import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { userFromSessionOrBearer } from "@/lib/auth";
import { MAX_SHARE_BYTES, createShare, shareJson } from "@/lib/shares/service";

/** The caller's shares */
export const GET = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "shares:write");
  const rows = await db.conversationShare.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
  return json({ items: rows.map((s) => shareJson(s, config.origin)) });
});

/** Share a conversation (already redacted by SinoBee) */
export const POST = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "shares:write");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_SHARE_BYTES * 1.4 + 65536) return json({ error: "share too large (5 MiB)" }, 413);
  const s = await createShare(user, await req.json());
  return json(shareJson(s, config.origin), 201);
});
