import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { saveFreePlan } from "@/lib/plans";

/** The free plan: allowance (max usage per 30 days, TWD at published prices), concurrency, on / off */
export const PUT = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z
    .object({
      name: z.string().trim().max(60),
      nameEn: z.string().trim().max(60),
      maxCostTwd: z.coerce.number(),
      concurrency: z.coerce.number().int(),
      active: z.boolean(),
    })
    .parse(await req.json());
  return json({ ok: true, plan: await saveFreePlan(admin.id, b) });
});
