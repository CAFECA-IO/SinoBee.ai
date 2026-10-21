import { z } from "zod";
import { handle, json } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { reviewTool } from "@/lib/tools/service";
import { audit } from "@/lib/roles";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { assertReviewInput } from "@/lib/admin/review";

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const { versionId, approve, note, acknowledged } = z
    .object({ versionId: z.string(), approve: z.boolean(), note: z.string().max(2000).optional(), acknowledged: z.boolean().optional() })
    .parse(await req.json());
  const v = await db.toolVersion.findUnique({ where: { id: versionId }, select: { scanFindings: true } });
  if (!v) throw new HttpError(404, "version not found");
  assertReviewInput({ findings: (v.scanFindings as unknown[]).length }, approve ? "approve" : "reject", note, acknowledged);
  await reviewTool(admin, versionId, approve, note?.trim() || undefined);
  await audit(admin.id, approve ? "tool.approve" : "tool.reject", { type: "toolVersion", id: versionId }, { note: note ?? null });
  return json({ ok: true });
});
