import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { priceLookupState, startPriceLookup } from "@/lib/ai-models";

/**
 * Add synced models to Model prices with prices looked up by AI (saved withdrawn until an admin checks them). Runs in
 * the background; poll GET.
 */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const { models } = z.object({ models: z.array(z.string().trim().min(3).max(200)).min(1).max(20) }).parse(await req.json());
  return json(startPriceLookup(admin.id, models));
});

export const GET = handle(async () => {
  await requireAdmin();
  return json(priceLookupState());
});
