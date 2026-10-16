import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { savePrice } from "@/lib/models";

const usd = z.coerce.number().min(0).max(100_000);

/** Save a new price row for a model (history is kept; a future effectiveAt schedules the change) */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z
    .object({
      modelId: z.string().trim().min(3).max(200),
      label: z.string().trim().min(1).max(100),
      vendor: z.string().trim().min(1).max(60),
      usd: z.object({ input: usd, cacheRead: usd, cacheWrite: usd, output: usd }),
      enabled: z.boolean().default(true),
      sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
      effectiveAt: z.string().datetime({ offset: true }).optional(),
    })
    .parse(await req.json());
  const row = await savePrice(admin.id, { ...b, effectiveAt: b.effectiveAt ? new Date(b.effectiveAt) : undefined });
  return json({ ok: true, price: row });
});
