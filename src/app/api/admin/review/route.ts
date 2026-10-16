import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { reviewVersion } from "@/lib/skills/service";
import { db } from "@/lib/db";
import { audit } from "@/lib/roles";

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z
    .object({ versionId: z.string(), decision: z.enum(["approve", "reject", "revoke"]), note: z.string().max(1000).optional() })
    .parse(await req.json());
  await reviewVersion(admin, b.versionId, b.decision, b.note);
  await audit(admin.id, `skill.${b.decision}`, { type: "skillVersion", id: b.versionId }, { note: b.note ?? null });
  return json({ ok: true });
});

/** verify / unverify a publisher (required for the "verified" trust level) */
export const PUT = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z.object({ userId: z.string(), verified: z.boolean() }).parse(await req.json());
  await db.user.update({ where: { id: b.userId }, data: { publisherVerified: b.verified } });
  await audit(admin.id, b.verified ? "publisher.verify" : "publisher.unverify", { type: "user", id: b.userId });
  return json({ ok: true });
});
