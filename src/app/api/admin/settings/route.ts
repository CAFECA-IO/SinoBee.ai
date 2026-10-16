import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { saveSetting } from "@/lib/settings/store";

/** Change one setting (super admin only). Secrets are encrypted before they are stored; "" clears. */
export const POST = handle(async (req: Request) => {
  const actor = await requireSuperAdmin();
  const b = z.object({ key: z.string().max(100), value: z.string().max(10_000) }).parse(await req.json());
  await saveSetting(actor.id, b.key, b.value);
  return json({ ok: true });
});
