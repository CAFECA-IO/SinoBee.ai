import { z } from "zod";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { revertChangeSet, settingsHistory } from "@/lib/settings/store";

/** The settings change log, one entry per applied change set (secrets show only that they changed) */
export const GET = handle(async () => {
  await requireAdmin();
  return json({ sets: await settingsHistory(30) });
});

/** Put a change set back (super admin): {revert: <set id>} → {reverted, skipped} */
export const POST = handle(async (req: Request) => {
  const actor = await requireSuperAdmin();
  const { revert } = z.object({ revert: z.string().min(1).max(100) }).parse(await req.json());
  return json(await revertChangeSet(actor.id, revert));
});
