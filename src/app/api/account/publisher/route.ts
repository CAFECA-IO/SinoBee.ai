import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { PUBLISHER_RE } from "@/lib/skills/spec";

const RESERVED = new Set(["admin", "api", "sinobee", "official", "hub", "new", "www", "root", "support"]);

/** Set the Skill Hub publisher id (once you have published skills it can no longer change) */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const b = z.object({ publisher: z.string().trim().toLowerCase(), displayName: z.string().trim().max(60).optional() }).parse(await req.json());
  if (!PUBLISHER_RE.test(b.publisher) || RESERVED.has(b.publisher)) return json({ error: "publisher id must be 2-39 chars: a-z, 0-9, hyphen" }, 400);
  if (user.publisher && user.publisher !== b.publisher && (await db.skill.count({ where: { publisherId: user.id } })))
    return json({ error: "publisher id cannot change after publishing skills" }, 400);
  const taken = await db.user.findUnique({ where: { publisher: b.publisher } });
  if (taken && taken.id !== user.id) return json({ error: "publisher id already taken" }, 409);
  await db.user.update({ where: { id: user.id }, data: { publisher: b.publisher, displayName: b.displayName ?? user.displayName } });
  return json({ ok: true });
});
