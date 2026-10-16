import { cookies } from "next/headers";
import { db } from "./db";
import { applySignInRole, initialRole, isAdminRole } from "./roles";
import { config } from "./config";
import { randomToken, sha256Hex } from "./crypto";
import type { VerifiedSignIn } from "./cafeca";
import type { User } from "@/generated/prisma/client";
import { HttpError } from "./errors";

export const SESSION_COOKIE = "sb_session";
export const BIND_COOKIE = "sb_bind";
const SESSION_DAYS = 30;

const secure = () => config.origin.startsWith("https://");

/** Browser binding cookie: nonces are only redeemable by the browser that requested them */
export async function getOrSetBind(): Promise<string> {
  const jar = await cookies();
  let b = jar.get(BIND_COOKIE)?.value;
  if (!b || !/^[A-Za-z0-9_-]{16,64}$/.test(b)) {
    b = randomToken(18);
    jar.set(BIND_COOKIE, b, { httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: 3600 });
  }
  return b;
}

export async function readBind(): Promise<string | undefined> {
  return (await cookies()).get(BIND_COOKIE)?.value;
}

/** Create or update the user record after a verified sign-in */
export async function upsertUser(v: VerifiedSignIn) {
  const account = v.account.toLowerCase();
  const role = initialRole(account);
  const handle = v.claims.handle ?? undefined;
  const user = await db.user.upsert({
    where: { account },
    create: {
      account,
      handle: handle ?? null,
      kycLevel: v.claims.kyc_level ?? null,
      role,
      isAdmin: isAdminRole(role),
      publisher: handle && /^[a-z0-9][a-z0-9-]{1,38}$/.test(handle) && !(await db.user.findUnique({ where: { publisher: handle } })) ? handle : null,
    },
    update: {
      lastLoginAt: new Date(),
      ...(handle !== undefined ? { handle } : {}),
      ...(v.claims.kyc_level !== undefined ? { kycLevel: v.claims.kyc_level } : {}),
    },
  });
  return applySignInRole(user);
}

export async function createSession(userId: string, channel?: { id: string; expiresAt: number }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({
    data: {
      tokenHash: sha256Hex(token),
      userId,
      expiresAt,
      channelId: channel?.id ?? null,
      channelExpiresAt: channel ? new Date(channel.expiresAt * 1000) : null,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secure(), path: "/", expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await db.session.deleteMany({ where: { tokenHash: sha256Hex(t) } });
  jar.delete(SESSION_COOKIE);
}

export type CurrentUser = User & { sessionId: string; channelId: string | null };

export async function currentUser(): Promise<CurrentUser | null> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!t) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256Hex(t) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return { ...s.user, sessionId: s.id, channelId: s.channelId };
}

export { HttpError };

export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "unauthorized");
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!isAdminRole(u.role)) throw new HttpError(403, "forbidden");
  return u;
}

export async function requireSuperAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== "SUPERADMIN") throw new HttpError(403, "forbidden");
  return u;
}

/** Bearer token auth for Hub API v1 (`sinobee login` device tokens or `sinobee keys set sinobee-hub`) */
export async function bearerAuth(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(sbh_[A-Za-z0-9_-]{20,})$/.exec(h);
  if (!m) return null;
  const tok = await db.apiToken.findUnique({ where: { tokenHash: sha256Hex(m[1]) }, include: { user: true, device: true } });
  if (!tok || tok.revokedAt) return null;
  const now = new Date();
  if (tok.expiresAt && tok.expiresAt < now) return null;
  if (tok.device?.revokedAt) return null;
  // throttle bookkeeping writes to once a minute
  if (!tok.lastUsedAt || now.getTime() - tok.lastUsedAt.getTime() > 60_000) {
    await db.apiToken.update({ where: { id: tok.id }, data: { lastUsedAt: now } });
    if (tok.deviceId) await db.device.update({ where: { id: tok.deviceId }, data: { lastSeenAt: now } });
  }
  return { user: tok.user, token: tok, scopes: tok.scopes.split(/\s+/).filter(Boolean), device: tok.device };
}

export async function userFromBearer(req: Request) {
  return (await bearerAuth(req))?.user ?? null;
}

/** Bearer token that carries `scope`; 401 without a valid token, 403 when the scope is missing */
export async function requireBearer(req: Request, scope: string) {
  const a = await bearerAuth(req);
  if (!a) throw new HttpError(401, "invalid or missing hub token — run `sinobee login`");
  if (!a.scopes.includes(scope)) throw new HttpError(403, `token lacks scope ${scope} — run \`sinobee login\` again`);
  return a;
}

/** Session cookie (website) or Bearer token with `scope` (SinoBee) */
export async function userFromSessionOrBearer(req: Request, scope: string) {
  if (req.headers.get("authorization")) return (await requireBearer(req, scope)).user;
  return requireUser();
}

export const devLoginEnabled = () => process.env.NODE_ENV !== "production" && process.env.DEV_LOGIN === "1";
