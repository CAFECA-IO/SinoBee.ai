import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { syncCatalog } from "@/lib/ai-models";

/** Ask every provider with an API key for the models it serves (GET /models) */
export const POST = handle(async () => {
  const admin = await requireAdmin();
  return json({ catalog: await syncCatalog(admin.id) });
});
