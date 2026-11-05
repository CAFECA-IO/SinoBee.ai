import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { listProviderModels, syncCatalog } from "@/lib/ai-models";

/**
 * Test a vendor's connection with the saved key and API address (the connector's 測試連線): lists its models.
 * On success the model catalog is synced too, so the warnings that depend on it are current.
 */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const { vendor } = z.object({ vendor: z.string().trim().min(1).max(60).regex(/^[a-z0-9_-]+$/i) }).parse(await req.json());
  const at = new Date().toISOString();
  try {
    const models = await listProviderModels(vendor.toLowerCase());
    await syncCatalog(admin.id).catch(() => undefined);
    return json({ ok: true, models: models.length, at });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message.slice(0, 300), at });
  }
});
