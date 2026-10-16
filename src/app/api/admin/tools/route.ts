import { z } from "zod";
import { handle, json } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { reviewTool } from "@/lib/tools/service";
import { audit } from "@/lib/roles";

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const { versionId, approve, note } = z.object({ versionId: z.string(), approve: z.boolean(), note: z.string().max(2000).optional() }).parse(await req.json());
  await reviewTool(admin, versionId, approve, note);
  await audit(admin.id, approve ? "tool.approve" : "tool.reject", { type: "toolVersion", id: versionId }, { note: note ?? null });
  return json({ ok: true });
});
