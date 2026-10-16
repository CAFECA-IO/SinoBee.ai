import { requireSuperAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { rotateHubKey } from "@/lib/settings/store";

/** New skill signing key; the old public key stays published */
export const POST = handle(async () => {
  const actor = await requireSuperAdmin();
  await rotateHubKey(actor.id);
  return json({ ok: true });
});
