import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { JOBS, TIERS, modelCatalogFromApi, saveTierConfig, tierConfig } from "@/lib/ai-models";

/** The platform's model tiers, job → tier mapping and the synced provider model lists */
export const GET = handle(async () => {
  await requireAdmin();
  return json({ ...(await tierConfig()), catalog: await modelCatalogFromApi() });
});

const tier = z.enum(TIERS);

/** Save the tiers (primary first, then fallbacks) and which tier each job uses */
export const PUT = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z
    .object({
      tiers: z.object(Object.fromEntries(TIERS.map((t) => [t, z.array(z.string().trim().max(200)).max(10)])) as Record<(typeof TIERS)[number], z.ZodArray<z.ZodString>>),
      jobs: z.object(Object.fromEntries(JOBS.map((j) => [j, tier])) as Record<(typeof JOBS)[number], typeof tier>),
    })
    .parse(await req.json());
  return json(await saveTierConfig(admin.id, b));
});
