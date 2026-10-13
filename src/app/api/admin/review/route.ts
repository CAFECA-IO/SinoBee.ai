import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { reviewVersion } from "@/lib/skills/service";
import { db } from "@/lib/db";

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z
    .object({ versionId: z.string(), decision: z.enum(["approve", "reject", "revoke"]), note: z.string().max(1000).optional() })
    .parse(await req.json());
  await reviewVersion(admin, b.versionId, b.decision, b.note);
  return json({ ok: true });
});

/** verify / unverify a publisher (required for the "verified" trust level) */
export const PUT = handle(async (req: Request) => {
  await requireAdmin();
  const b = z.object({ userId: z.string(), verified: z.boolean() }).parse(await req.json());
  await db.user.update({ where: { id: b.userId }, data: { publisherVerified: b.verified } });
  return json({ ok: true });
});
