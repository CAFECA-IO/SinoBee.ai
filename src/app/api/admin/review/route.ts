import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { reviewVersion } from "@/lib/skills/service";
import { db } from "@/lib/db";
import { audit } from "@/lib/roles";
import { HttpError } from "@/lib/errors";
import { assertReviewInput } from "@/lib/admin/review";

/** approve / reject / revoke a skill version; a rejection or revocation needs a reason, approving a flagged one an acknowledgement */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z
    .object({ versionId: z.string(), decision: z.enum(["approve", "reject", "revoke"]), note: z.string().max(1000).optional(), acknowledged: z.boolean().optional() })
    .parse(await req.json());
  const v = await db.skillVersion.findUnique({ where: { id: b.versionId }, select: { scanFindings: true, status: true } });
  if (!v) throw new HttpError(404, "version not found");
  if (b.decision === "revoke" && v.status !== "APPROVED") throw new HttpError(400, "only an approved version can be revoked; reject a pending one");
  assertReviewInput({ findings: (v.scanFindings as unknown[]).length }, b.decision, b.note, b.acknowledged);
  await reviewVersion(admin, b.versionId, b.decision, b.note?.trim() || undefined);
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
