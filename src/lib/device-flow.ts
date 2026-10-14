import { randomInt } from "node:crypto";
import { db } from "./db";
import { config } from "./config";
import { randomToken, sha256Hex } from "./crypto";
import { HttpError } from "./errors";

/**
 * `sinobee login` — OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * 1. SinoBee POSTs /api/v1/device/code → device_code (secret, kept by the client) + user_code (shown to the user)
 * 2. The user opens /device, signs in with CAFECA and approves the request
 * 3. SinoBee polls /api/v1/device/token until it receives an `sbh_` access token bound to a Device
 */

export const SCOPES = ["skills:publish", "tools:write", "vault:rw", "shares:write"] as const;
export type Scope = (typeof SCOPES)[number];
export const DEFAULT_SCOPES: Scope[] = [...SCOPES];

const CODE_TTL_S = 900;
const INTERVAL_S = 5;
/** device tokens expire after a year of existence; any use within the window keeps the device listed */
const TOKEN_TTL_DAYS = 365;
/** no 0/O/1/I/L/U to avoid misreading */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export const normalizeUserCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatUserCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

export function parseScopes(s: string | undefined | null): Scope[] {
  if (!s || !s.trim()) return DEFAULT_SCOPES;
  const out = s.split(/[\s,]+/).filter(Boolean);
  const bad = out.filter((x) => !(SCOPES as readonly string[]).includes(x));
  if (bad.length) throw new HttpError(400, `invalid_scope: ${bad.join(" ")}`);
  return [...new Set(out)] as Scope[];
}

export async function startDeviceAuth(input: { deviceName: string; platform?: string | null; scope?: string | null; ip?: string | null }) {
  const scopes = parseScopes(input.scope);
  const deviceCode = randomToken(32);
  let userCode = "";
  for (let i = 0; i < 5; i++) {
    userCode = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    if (!(await db.deviceAuth.findUnique({ where: { userCode } }))) break;
  }
  await db.deviceAuth.create({
    data: {
      deviceCodeHash: sha256Hex(deviceCode),
      userCode,
      scopes: scopes.join(" "),
      deviceName: input.deviceName.slice(0, 80),
      platform: input.platform?.slice(0, 80) ?? null,
      ip: input.ip?.slice(0, 64) ?? null,
      interval: INTERVAL_S,
      expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
    },
  });
  const uri = `${config.origin}/device`;
  return {
    device_code: deviceCode,
    user_code: formatUserCode(userCode),
    verification_uri: uri,
    verification_uri_complete: `${uri}?code=${formatUserCode(userCode)}`,
    expires_in: CODE_TTL_S,
    interval: INTERVAL_S,
  };
}

/** Look up a pending request by the code the user typed (for the approval page) */
export async function pendingByUserCode(code: string) {
  const a = await db.deviceAuth.findUnique({ where: { userCode: normalizeUserCode(code) } });
  if (!a || a.expiresAt < new Date() || a.status !== "PENDING") return null;
  return a;
}

export async function decideDeviceAuth(userId: string, code: string, approve: boolean) {
  const a = await pendingByUserCode(code);
  if (!a) throw new HttpError(404, "code_not_found_or_expired");
  const r = await db.deviceAuth.updateMany({
    where: { id: a.id, status: "PENDING" },
    data: approve ? { status: "APPROVED", userId, approvedAt: new Date() } : { status: "DENIED", userId },
  });
  if (r.count !== 1) throw new HttpError(409, "already_decided");
  return { deviceName: a.deviceName, scopes: a.scopes.split(" ") };
}

type TokenResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: "authorization_pending" | "slow_down" | "access_denied" | "expired_token" | "invalid_grant" };

/** Poll endpoint: RFC 8628 §3.5 error codes */
export async function pollDeviceToken(deviceCode: string): Promise<TokenResult> {
  const a = await db.deviceAuth.findUnique({ where: { deviceCodeHash: sha256Hex(deviceCode) } });
  if (!a || a.status === "CONSUMED") return { ok: false, error: "invalid_grant" };
  const now = new Date();
  if (a.expiresAt < now) return { ok: false, error: "expired_token" };
  if (a.status === "DENIED") return { ok: false, error: "access_denied" };
  if (a.status === "PENDING") {
    const tooFast = a.lastPollAt && now.getTime() - a.lastPollAt.getTime() < (a.interval - 1) * 1000;
    await db.deviceAuth.update({ where: { id: a.id }, data: { lastPollAt: now, ...(tooFast ? { interval: Math.min(a.interval + 5, 60) } : {}) } });
    return { ok: false, error: tooFast ? "slow_down" : "authorization_pending" };
  }
  // APPROVED → consume exactly once
  const claimed = await db.deviceAuth.updateMany({ where: { id: a.id, status: "APPROVED" }, data: { status: "CONSUMED" } });
  if (claimed.count !== 1 || !a.userId) return { ok: false, error: "invalid_grant" };
  const user = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
  const device = await db.device.create({ data: { userId: user.id, name: a.deviceName, platform: a.platform } });
  const token = `sbh_${randomToken(30)}`;
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000);
  await db.apiToken.create({
    data: { userId: user.id, name: `device: ${a.deviceName}`, prefix: token.slice(0, 10), tokenHash: sha256Hex(token), scopes: a.scopes, deviceId: device.id, expiresAt },
  });
  return {
    ok: true,
    body: {
      access_token: token,
      token_type: "Bearer",
      scope: a.scopes,
      expires_in: TOKEN_TTL_DAYS * 86400,
      device_id: device.id,
      account: user.account,
      handle: user.handle,
      publisher: user.publisher,
    },
  };
}

export async function revokeDevice(userId: string, deviceId: string) {
  const d = await db.device.findFirst({ where: { id: deviceId, userId, revokedAt: null } });
  if (!d) throw new HttpError(404, "not_found");
  const now = new Date();
  await db.$transaction([
    db.device.update({ where: { id: d.id }, data: { revokedAt: now } }),
    db.apiToken.updateMany({ where: { deviceId: d.id, revokedAt: null }, data: { revokedAt: now } }),
  ]);
}
