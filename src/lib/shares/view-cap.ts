import { createHmac, timingSafeEqual } from "node:crypto";
import { macKey } from "../settings/box";

/**
 * Document pages run in a sandboxed frame with an opaque origin, so their own requests (scripts, images, data
 * files) carry no cookies. The share page, after checking who may view, hands the frame a capability in the path
 * instead: /api/shares/<id>/raw/<cap>/<file>. It names one share and expires after 12 hours.
 */
const TTL = 12 * 3600;

function mac(id: string, exp: number) {
  return createHmac("sha256", macKey("share-view")).update(`${id}:${exp}`).digest("base64url").slice(0, 27);
}

export function viewCap(id: string, now = Date.now()): string {
  // rounded to the hour so a page reload reuses the same URLs (browser cache)
  const exp = Math.ceil(now / 3600_000) * 3600 + TTL;
  return `${exp.toString(36)}.${mac(id, exp)}`;
}

export function checkCap(id: string, cap: string, now = Date.now()): boolean {
  const m = /^([0-9a-z]{1,10})\.([A-Za-z0-9_-]{27})$/.exec(cap);
  if (!m) return false;
  const exp = parseInt(m[1], 36);
  if (!(exp * 1000 > now) || exp * 1000 > now + (TTL + 7200) * 1000) return false;
  const a = Buffer.from(m[2]), b = Buffer.from(mac(id, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const rawBase = (id: string, cap: string) => `/api/shares/${id}/raw/${cap}/`;
