import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { savePlan } from "@/lib/plans";

/** Create or update a plan. Refused when fee ÷ max cost (the multiplier) is under 1.5; L6/L168 are derived. */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z
    .object({
      id: z.string().optional(),
      code: z.string().trim(),
      name: z.string().trim().max(60),
      nameEn: z.string().trim().max(60),
      feeTwd: z.coerce.number(),
      multiplier: z.coerce.number(),
      concurrency: z.coerce.number().int(),
      active: z.boolean().default(true),
      sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
    })
    .parse(await req.json());
  return json({ ok: true, plan: await savePlan(admin.id, b) });
});
