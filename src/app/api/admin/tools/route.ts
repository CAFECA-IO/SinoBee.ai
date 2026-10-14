import { z } from "zod";
import { handle, json } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { reviewTool } from "@/lib/tools/service";

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const { versionId, approve, note } = z.object({ versionId: z.string(), approve: z.boolean(), note: z.string().max(2000).optional() }).parse(await req.json());
  await reviewTool(admin, versionId, approve, note);
  return json({ ok: true });
});
