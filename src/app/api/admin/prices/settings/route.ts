import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { savePricingSettings } from "@/lib/models";

/** Change the base FX rate and buffer; every model gets a new price row at the new rate */
export const PUT = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z
    .object({ fx: z.coerce.number(), buffer: z.coerce.number(), effectiveAt: z.string().datetime({ offset: true }).optional() })
    .parse(await req.json());
  await savePricingSettings(admin.id, { fx: b.fx, buffer: b.buffer, effectiveAt: b.effectiveAt ? new Date(b.effectiveAt) : undefined });
  return json({ ok: true });
});
