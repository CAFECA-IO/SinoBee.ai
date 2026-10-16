import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { config } from "./config";
import { HttpError } from "./errors";
import type { Prisma, User, UserRole } from "@/generated/prisma/client";

/**
 * Roles: USER < ADMIN < SUPERADMIN. There is at most one SUPERADMIN (the site owner).
 *
 * Owner bootstrap (runs once per site, never again after a SUPERADMIN has existed):
 *   - OWNER_ACCOUNT set → that account becomes SUPERADMIN on its first sign-in.
 *   - otherwise → a one-time claim code is printed in the server log at startup; the first signed-in user who
 *     enters it at /admin/claim becomes SUPERADMIN. A new code is printed on every restart (the old one dies).
 * The SUPERADMIN grants/revokes ADMIN and can hand SUPERADMIN to someone else (they become ADMIN).
 * Every change is written to AdminAudit. Roles are never overwritten at sign-in.
 */

const BOOTSTRAPPED = "owner.bootstrapped";
const CLAIM = "owner.claim";
const CLAIM_FAILS = "owner.claimFails";
const MAX_FAILS = 10;

export const isAdminRole = (r: UserRole | string | null | undefined) => r === "ADMIN" || r === "SUPERADMIN";

export async function audit(actorId: string | null, action: string, target?: { type: string; id: string }, detail?: unknown) {
  await db.adminAudit.create({
    data: { actorId, action, targetType: target?.type ?? null, targetId: target?.id ?? null, detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}

const setting = async (key: string) => (await db.siteSetting.findUnique({ where: { key } }))?.value ?? null;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** codes are shown grouped (ABCD-EFGH-JKLM); compare without dashes/spaces/case */
const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function ownerBootstrapped(): Promise<boolean> {
  if (await setting(BOOTSTRAPPED)) return true;
  return (await db.user.count({ where: { role: "SUPERADMIN" } })) > 0;
}

async function markBootstrapped(tx: Prisma.TransactionClient, userId: string) {
  await tx.siteSetting.upsert({ where: { key: BOOTSTRAPPED }, create: { key: BOOTSTRAPPED, value: userId }, update: { value: userId } });
  await tx.siteSetting.deleteMany({ where: { key: { in: [CLAIM, CLAIM_FAILS] } } });
}

/** Role for a brand-new user (ADMIN_ACCOUNTS only seeds the first role; it never overrides a later change) */
export const initialRole = (account: string): UserRole => (config.adminAccounts.includes(account.toLowerCase()) ? "ADMIN" : "USER");

/** Called after every verified sign-in. Only promotes OWNER_ACCOUNT before the site has an owner. */
export async function applySignInRole(user: User): Promise<User> {
  if (user.role === "SUPERADMIN" || !config.ownerAccount || user.account !== config.ownerAccount) return user;
  if (await ownerBootstrapped()) return user;
  const out = await db.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: user.id }, data: { role: "SUPERADMIN", isAdmin: true } });
    await markBootstrapped(tx, user.id);
    return u;
  });
  await audit(user.id, "owner.bootstrap", { type: "user", id: user.id }, { via: "OWNER_ACCOUNT", account: user.account });
  return out;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function newCode() {
  const b = randomBytes(12);
  const s = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/**
 * Issue a fresh claim code (startup, or after too many wrong guesses) when the site has no owner and no
 * OWNER_ACCOUNT. Only the hash is stored; the code itself goes to the server log.
 */
export async function issueClaimCode(log: (s: string) => void = console.log): Promise<string | null> {
  if (config.ownerAccount || (await ownerBootstrapped())) return null;
  const code = newCode();
  await db.$transaction([
    db.siteSetting.upsert({ where: { key: CLAIM }, create: { key: CLAIM, value: sha(normalize(code)) }, update: { value: sha(normalize(code)) } }),
    db.siteSetting.deleteMany({ where: { key: CLAIM_FAILS } }),
  ]);
  log(
    [
      "",
      "================================================================",
      " SinoBee.ai has no owner yet.",
      ` Owner claim code: ${code}`,
      " Sign in with CAFECA, open /admin/claim and enter the code.",
      " Set OWNER_ACCOUNT to skip this. A new code is printed on every restart.",
      "================================================================",
      "",
    ].join("\n"),
  );
  return code;
}

export type OwnerState = { bootstrapped: boolean; mode: "owner-account" | "claim-code" };
export async function ownerState(): Promise<OwnerState> {
  return { bootstrapped: await ownerBootstrapped(), mode: config.ownerAccount ? "owner-account" : "claim-code" };
}

/** Enter the claim code. Single use; races are settled by deleting the stored hash. */
export async function claimSite(user: User, code: string): Promise<User> {
  if (await ownerBootstrapped()) throw new HttpError(409, "this site already has an owner");
  if (config.ownerAccount) throw new HttpError(403, "the owner is set by OWNER_ACCOUNT");
  const stored = await setting(CLAIM);
  if (!stored) throw new HttpError(409, "no claim code issued; restart the server to print one");
  const given = Buffer.from(sha(normalize(code)), "hex");
  if (!timingSafeEqual(given, Buffer.from(stored, "hex"))) {
    const fails = Number((await setting(CLAIM_FAILS)) ?? 0) + 1;
    await db.siteSetting.upsert({ where: { key: CLAIM_FAILS }, create: { key: CLAIM_FAILS, value: String(fails) }, update: { value: String(fails) } });
    await audit(user.id, "owner.claim.fail", { type: "user", id: user.id }, { fails });
    if (fails >= MAX_FAILS) {
      await issueClaimCode();
      throw new HttpError(429, "too many wrong codes; a new code was printed in the server log");
    }
    throw new HttpError(403, "wrong code");
  }
  const out = await db.$transaction(async (tx) => {
    const won = await tx.siteSetting.deleteMany({ where: { key: CLAIM, value: stored } });
    if (won.count !== 1) throw new HttpError(409, "the code was already used");
    if ((await tx.user.count({ where: { role: "SUPERADMIN" } })) > 0) throw new HttpError(409, "this site already has an owner");
    const u = await tx.user.update({ where: { id: user.id }, data: { role: "SUPERADMIN", isAdmin: true } });
    await markBootstrapped(tx, user.id);
    return u;
  });
  await audit(user.id, "owner.bootstrap", { type: "user", id: user.id }, { via: "claim-code", account: user.account });
  return out;
}

function mustBeSuper(actor: Pick<User, "role">) {
  if (actor.role !== "SUPERADMIN") throw new HttpError(403, "only the super admin can change roles");
}

/** Grant (ADMIN) or revoke (USER) admin rights. SUPERADMIN only; cannot touch itself or another SUPERADMIN. */
export async function setRole(actor: User, targetId: string, role: "ADMIN" | "USER"): Promise<User> {
  mustBeSuper(actor);
  if (role !== "ADMIN" && role !== "USER") throw new HttpError(400, "role must be ADMIN or USER");
  if (targetId === actor.id) throw new HttpError(400, "you cannot change your own role; transfer super admin instead");
  const t = await db.user.findUnique({ where: { id: targetId } });
  if (!t) throw new HttpError(404, "user not found");
  if (t.role === "SUPERADMIN") throw new HttpError(400, "the super admin's role can only change by transfer");
  if (t.role === role) return t;
  const u = await db.user.update({ where: { id: t.id }, data: { role, isAdmin: isAdminRole(role) } });
  await audit(actor.id, role === "ADMIN" ? "role.grant" : "role.revoke", { type: "user", id: t.id }, { account: t.account, from: t.role, to: role });
  return u;
}

/** Hand SUPERADMIN to another user; the current one becomes ADMIN. `confirm` must repeat the target's account. */
export async function transferSuperAdmin(actor: User, targetId: string, confirm: string): Promise<User> {
  mustBeSuper(actor);
  if (targetId === actor.id) throw new HttpError(400, "you already are the super admin");
  const t = await db.user.findUnique({ where: { id: targetId } });
  if (!t) throw new HttpError(404, "user not found");
  if (confirm.trim().toLowerCase() !== t.account) throw new HttpError(400, "confirmation does not match the target account");
  const out = await db.$transaction(async (tx) => {
    const me = await tx.user.findUnique({ where: { id: actor.id } });
    if (me?.role !== "SUPERADMIN") throw new HttpError(403, "only the super admin can transfer");
    await tx.user.update({ where: { id: actor.id }, data: { role: "ADMIN", isAdmin: true } });
    return tx.user.update({ where: { id: t.id }, data: { role: "SUPERADMIN", isAdmin: true } });
  });
  await audit(actor.id, "role.transfer", { type: "user", id: t.id }, { from: actor.account, to: t.account, previousRole: t.role });
  return out;
}
