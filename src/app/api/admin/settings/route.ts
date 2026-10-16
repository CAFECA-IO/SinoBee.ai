import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { handle, json } from "@/lib/http";
import { saveSetting } from "@/lib/settings/store";

const change = z.object({ key: z.string().max(100), value: z.string().max(10_000) });

/**
 * Change settings (super admin only): one {key, value} or {changes: [...]}. Secrets are encrypted before they
 * are stored; "" clears. Each change is validated and saved on its own; failures are reported per key.
 */
export const POST = handle(async (req: Request) => {
  const actor = await requireSuperAdmin();
  const body = await req.json();
  const changes = Array.isArray(body?.changes) ? z.array(change).max(100).parse(body.changes) : [change.parse(body)];
  const errors: Record<string, string> = {};
  for (const c of changes) {
    try {
      await saveSetting(actor.id, c.key, c.value);
    } catch (e) {
      errors[c.key] = e instanceof HttpError ? e.message : "could not be saved";
    }
  }
  const failed = Object.keys(errors).length;
  if (failed && failed === changes.length && changes.length === 1) return json({ error: errors[changes[0].key] }, 400);
  return json({ ok: failed === 0, saved: changes.length - failed, errors });
});
