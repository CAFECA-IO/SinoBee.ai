import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { recordBehavior } from "@/lib/skills/service";
import { audit } from "@/lib/roles";

/** Record an evaluation skill's sandbox behavior test (run with SinoBee before approving it) */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z.object({ versionId: z.string(), ok: z.boolean(), note: z.string().max(1000).optional() }).parse(await req.json());
  const r = await recordBehavior(admin, b.versionId, b.ok, b.note);
  await audit(admin.id, b.ok ? "skill.behavior_pass" : "skill.behavior_fail", { type: "skillVersion", id: b.versionId }, { note: b.note ?? null });
  return json({ ok: true, securityReport: r });
});
