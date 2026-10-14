import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { userFromSessionOrBearer } from "@/lib/auth";
import { MAX_SHARE_BYTES, MAX_TOTAL_BYTES, createShare, shareJson, type UploadFile } from "@/lib/shares/service";

/** The caller's shares */
export const GET = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "shares:write");
  const rows = await db.conversationShare.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
  return json({ items: rows.map((s) => shareJson(s, config.origin)) });
});

/**
 * Share a conversation (already redacted by SinoBee).
 * JSON body, or multipart/form-data with a `share` JSON field and `files` (attachments up to 25 MB each, 100 MB total).
 */
export const POST = handle(async (req: Request) => {
  const user = await userFromSessionOrBearer(req, "shares:write");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_TOTAL_BYTES + MAX_SHARE_BYTES * 1.4 + 1048576) return json({ error: "share too large" }, 413);
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData();
    const meta = form.get("share");
    if (typeof meta !== "string") return json({ error: "multipart field `share` (JSON) required" }, 400);
    const uploads: UploadFile[] = [];
    for (const f of form.getAll("files")) if (f instanceof File) uploads.push({ name: f.name || "file", mime: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) });
    const s = await createShare(user, JSON.parse(meta), uploads);
    return json(shareJson(s, config.origin), 201);
  }
  const s = await createShare(user, await req.json());
  return json(shareJson(s, config.origin), 201);
});
