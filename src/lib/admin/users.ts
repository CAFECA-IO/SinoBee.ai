import { db, icontains } from "../db";
import { HttpError } from "../errors";
import { audit } from "../roles";
import { listPlans } from "../plans";
import { quotaContext, weekBudget, windowUse } from "../llm/quota";
import type { User } from "@/generated/prisma/client";

/** Users in /admin: a table with what support needs at a glance, and one user's whole picture */

export const USER_FILTERS = ["all", "subscribed", "staff", "publishers", "disabled"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];
export const USERS_PAGE = 25;
const DAY = 86400_000;

const filterWhere = (f: UserFilter, now: Date) =>
  f === "staff" ? { role: { in: ["ADMIN" as const, "SUPERADMIN" as const] } }
  : f === "publishers" ? { publisher: { not: null }, skills: { some: {} } }
  : f === "disabled" ? { disabledAt: { not: null } }
  : f === "subscribed" ? { subscriptions: { some: { cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } } } }
  : {};

export async function userCounts(now = new Date()) {
  const [all, subscribed, staff, publishers, disabled] = await Promise.all(USER_FILTERS.map((f) => db.user.count({ where: filterWhere(f, now) })));
  return { all, subscribed, staff, publishers, disabled };
}

export async function userList(opts: { filter: UserFilter; q?: string; page?: number; locale?: string }, now = new Date()) {
  const q = opts.q?.trim();
  const where = { ...filterWhere(opts.filter, now), ...(q ? { OR: [{ account: icontains(q.toLowerCase()) }, { handle: icontains(q) }, { publisher: icontains(q) }] } : {}) };
  const page = Math.max(1, opts.page ?? 1);
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({ where, orderBy: [{ lastLoginAt: "desc" }], skip: (page - 1) * USERS_PAGE, take: USERS_PAGE }),
  ]);
  const ids = users.map((u) => u.id);
  const since = new Date(now.getTime() - 30 * DAY);
  const [subs, usage, pays, plans] = await Promise.all([
    db.subscription.findMany({ where: { userId: { in: ids }, cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } } }),
    db.usageLedger.groupBy({ by: ["userId"], where: { userId: { in: ids }, status: { not: "HELD" }, settledAt: { gte: since } }, _sum: { settledTwd: true } }),
    db.payment.groupBy({ by: ["userId", "status"], where: { userId: { in: ids }, provider: { not: "TWDC" } }, _count: { _all: true }, _sum: { amountTwd: true, refundedTwd: true } }),
    listPlans({ includeFree: true }),
  ]);
  const en = opts.locale && !opts.locale.startsWith("zh");
  const nameOf = (p: { name: string; nameEn: string }) => (en ? p.nameEn : p.name);
  const planName = new Map(plans.map((p) => [p.code, nameOf(p)]));
  const free = plans.find((p) => p.code === "free" && p.active);
  const freeName = free ? nameOf(free) : null;
  const rows = users.map((u) => {
    const sub = subs.find((s) => s.userId === u.id);
    const mine = pays.filter((p) => p.userId === u.id);
    const paid = mine.filter((p) => p.status === "CONFIRMED" || p.status === "REFUNDED");
    return {
      id: u.id, handle: u.handle ?? u.publisher, account: u.account, role: u.role, disabled: !!u.disabledAt, lastLoginAt: u.lastLoginAt,
      plan: sub ? (planName.get(sub.plan) ?? sub.plan) : freeName,
      usage30Twd: Number(usage.find((x) => x.userId === u.id)?._sum.settledTwd ?? 0),
      paidTwd: paid.reduce((a, p) => a + (p._sum.amountTwd ?? 0) - (p._sum.refundedTwd ?? 0), 0),
      pending: mine.find((p) => p.status === "PENDING")?._count._all ?? 0,
      failed: mine.find((p) => p.status === "FAILED")?._count._all ?? 0,
    };
  });
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / USERS_PAGE)) };
}

export async function userDetail(id: string, locale = "zh-TW", now = new Date()) {
  const u = await db.user.findUnique({ where: { id } });
  if (!u) return null;
  const since = new Date(now.getTime() - 30 * DAY);
  const [subs, usage, byModel, payments, skills, tools, plans] = await Promise.all([
    db.subscription.findMany({ where: { userId: id, cancelledAt: null }, orderBy: { startsAt: "desc" }, take: 6 }),
    db.usageLedger.aggregate({ where: { userId: id, status: { not: "HELD" }, settledAt: { gte: since } }, _sum: { settledTwd: true }, _count: { _all: true } }),
    db.usageLedger.groupBy({ by: ["modelId"], where: { userId: id, status: { not: "HELD" }, settledAt: { gte: since } }, _sum: { settledTwd: true }, orderBy: { _sum: { settledTwd: "desc" } }, take: 3 }),
    db.payment.findMany({ where: { userId: id, provider: { not: "TWDC" } }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.skill.findMany({ where: { publisherId: id }, select: { name: true, latestVersion: true }, take: 10 }),
    db.tool.findMany({ where: { ownerId: id }, select: { name: true, latestVersion: true }, take: 10 }),
    listPlans({ includeFree: true }),
  ]);
  // the model-quota windows now; null when the user has neither a subscription nor the free plan
  const qc = await quotaContext(id, now).catch(() => null);
  const wk = qc ? await weekBudget(qc, now) : null;
  const win = await windowUse(id, now, wk?.from);
  const current = subs.find((s) => s.startsAt <= now && s.endsAt > now) ?? null;
  const plan = plans.find((p) => p.code === (current?.plan ?? "free")) ?? null;
  const used = Number(usage._sum.settledTwd ?? 0);
  return {
    user: u,
    current: current && { plan: (locale.startsWith("zh") ? plan?.name : plan?.nameEn) ?? current.plan, startsAt: current.startsAt, endsAt: current.endsAt },
    upcoming: subs.filter((s) => s.startsAt > now).length,
    allowanceTwd: plan?.maxCostTwd ?? 0,
    usage30Twd: used,
    calls30: usage._count._all,
    topModels: byModel.map((m) => ({ modelId: m.modelId, twd: Number(m._sum.settledTwd ?? 0), share: used > 0 ? Number(m._sum.settledTwd ?? 0) / used : 0 })),
    // the model-quota windows now (rolling 6 h; the week from Sunday 00:00 UTC), for the admin's reset buttons
    quota: {
      w6Twd: win.w6, l6Twd: qc?.limits.l6 ?? 0, w168Twd: win.w168, l168Twd: wk?.availableTwd ?? 0, weekEndsAt: win.weekEndsAt,
      grantTwd: wk?.grantTwd ?? 0, carryInTwd: wk?.carryInTwd ?? 0, capTwd: wk?.capTwd ?? 0,
      reset6hAt: u.quotaReset6hAt, resetWeekAt: u.quotaResetWeekAt,
    },
    level: qc?.level ?? null,
    payments,
    skills,
    tools,
  };
}

/**
 * Disable or re-enable an account: a disabled user cannot sign in, and their sessions and API tokens stop working
 * (checked on every request). Staff must lose their role first, so an admin cannot lock out another admin.
 */
export async function setDisabled(actor: Pick<User, "id">, userId: string, disabled: boolean, reason?: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new HttpError(404, "user not found");
  if (u.id === actor.id) throw new HttpError(400, "you cannot disable your own account");
  if (disabled && u.role !== "USER") throw new HttpError(400, "revoke the admin role first");
  if (disabled && !(reason ?? "").trim()) throw new HttpError(400, "give a reason");
  const next = await db.user.update({ where: { id: userId }, data: disabled ? { disabledAt: new Date(), disabledReason: reason!.trim().slice(0, 500) } : { disabledAt: null, disabledReason: null } });
  if (disabled) await db.session.deleteMany({ where: { userId } });
  await audit(actor.id, disabled ? "user.disable" : "user.enable", { type: "user", id: userId }, disabled ? { reason: next.disabledReason } : undefined);
  return next;
}
