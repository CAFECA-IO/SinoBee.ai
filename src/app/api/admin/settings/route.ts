import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { handle, json } from "@/lib/http";
import { saveSetting, SettingError } from "@/lib/settings/store";

const change = z.object({ key: z.string().max(100), value: z.string().max(10_000) });

/**
 * Apply a change set (super admin only): {changes: [{key, value}], confirmed?: [key…]} or one {key, value}. Secrets
 * are encrypted before they are stored; "" clears. A dangerous change is only applied when its key is in
 * `confirmed` (the review panel's "我了解"). Every change is validated and saved on its own and the set is audited
 * under one batch id (the change log groups and reverts by it); failures come back per key in both languages.
 */
export const POST = handle(async (req: Request) => {
  const actor = await requireSuperAdmin();
  const body = await req.json();
  const changes = Array.isArray(body?.changes) ? z.array(change).max(200).parse(body.changes) : [change.parse(body)];
  const confirmed = new Set(z.array(z.string().max(100)).max(200).optional().parse(body?.confirmed) ?? []);
  const batch = randomUUID();
  const errors: Record<string, { zh: string; en: string }> = {};
  for (const c of changes) {
    try {
      await saveSetting(actor.id, c.key, c.value, { batch, confirmed: confirmed.has(c.key) });
    } catch (e) {
      errors[c.key] = e instanceof SettingError ? e.l : e instanceof HttpError ? { zh: e.message, en: e.message } : { zh: "無法儲存", en: "could not be saved" };
    }
  }
  const failed = Object.keys(errors).length;
  if (failed && failed === changes.length && changes.length === 1) return json({ error: errors[changes[0].key].zh, errors }, 400);
  return json({ ok: failed === 0, saved: changes.length - failed, errors, batch });
});
