import { createHmac, timingSafeEqual } from "node:crypto";
import { macKey } from "./settings/box";
import { isAdminRole } from "./roles";

/**
 * Signed role hint, refreshed by /api/site while the database is up. Sessions live in the database, so during an
 * outage this cookie is the only way to tell an admin from a visitor. It grants nothing: it only decides whether the
 * maintenance notice includes the error details. Value: "<uid>.<A|U>.<expires epoch s>.<mac>".
 */
export const ROLE_HINT_COOKIE = "sb_role";
const DAYS = 7;

const mac = (body: string) => createHmac("sha256", macKey("role-hint")).update(body).digest("base64url");

export function roleHintValue(userId: string, role: string): { value: string; expires: Date } {
  const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
  const body = `${userId}.${isAdminRole(role) ? "A" : "U"}.${exp}`;
  return { value: `${body}.${mac(body)}`, expires: new Date(exp * 1000) };
}

export function isAdminHint(value: string | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  const [uid, r, exp, sig] = parts;
  if (r !== "A" || !(Number(exp) * 1000 > Date.now())) return false;
  const want = Buffer.from(mac(`${uid}.${r}.${exp}`));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
