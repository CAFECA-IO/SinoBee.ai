import { db } from "./db";
import { config } from "./config";
import { hubPublicKeys } from "./skills/signing";
import { resolve } from "./settings/cache";
import { SETTINGS } from "./settings/registry";
import { reportTargets } from "./admin/reports";

/** Things an admin should look at, for the sidebar badges and the overview page */
export async function adminCounts() {
  const [skills, tools, reports, payments, disputes, screening] = await Promise.all([
    db.skillVersion.count({ where: { status: "PENDING_REVIEW" } }),
    db.toolVersion.count({ where: { status: "PENDING_REVIEW" } }),
    db.report.count({ where: { resolvedAt: null } }),
    db.payment.count({ where: { status: "PENDING", provider: { not: "TWDC" }, createdAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
    db.task.count({ where: { status: "DISPUTED" } }),
    db.task.count({ where: { status: "SCREENING" } }),
  ]);
  const health = settingsHealth();
  return {
    pending: skills, tools, reports, payments, disputes, screening,
    settings: health.filter((c) => !c.ok && c.level === "error").length,
    settingsOpen: health.filter((c) => !c.ok).length,
  };
}

export type HealthCheck = { id: string; ok: boolean; level: "error" | "warn"; group: string; keys: string[]; detail?: string };

/** Go-live checklist computed from the settings (no network calls) */
export function settingsHealth(): HealthCheck[] {
  const set = (k: string) => !!resolve(k).value;
  const providers = ["anthropic", "openai", "gemini", "deepseek"];
  const keys = providers.filter((p) => set(`apiKeys.${p}`));
  const live = config.payments.mode !== "mock";
  const checks: HealthCheck[] = [
    { id: "payments", ok: !live || (set("oen.merchantId") && set("oen.token")), level: "error", group: "payments", keys: ["oen.merchantId", "oen.token"], detail: live ? config.oen.env : "mock" },
    { id: "paymentsLive", ok: !live || config.oen.env === "production", level: "warn", group: "payments", keys: ["oen.env"], detail: config.oen.env },
    { id: "modelKeys", ok: keys.length > 0, level: "error", group: "apiKeys", keys: providers.map((p) => `apiKeys.${p}`), detail: `${keys.length}/${providers.length}` },
    { id: "legal", ok: SETTINGS.filter((d) => d.group === "legal" && d.required).every((d) => set(d.key)), level: "warn", group: "legal", keys: SETTINGS.filter((d) => d.group === "legal" && d.required).map((d) => d.key) },
    { id: "hubKey", ok: hubPublicKeys().length > 0, level: "error", group: "hub", keys: ["hub.signingKey"] },
    { id: "boltchain", ok: config.boltchain.enabled, level: "warn", group: "boltchain", keys: ["boltchain.rpcUrl"] },
    { id: "signatures", ok: config.llm.requireSignature, level: "warn", group: "llm", keys: ["llm.requireSignature"] },
  ];
  return checks;
}

/** Headline numbers for the overview */
export async function adminStats() {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86400_000);
  const day = new Date(now.getTime() - 86400_000);
  const [subs, revenue, refunds, relay, users] = await Promise.all([
    db.subscription.count({ where: { cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } } }),
    // test-mode payments are not revenue
    db.payment.aggregate({ where: { status: { in: ["CONFIRMED", "REFUNDED"] }, provider: { not: "TWDC" }, sandbox: false, confirmedAt: { gte: since } }, _sum: { amountTwd: true } }),
    db.payment.aggregate({ where: { refundedAt: { gte: since }, sandbox: false }, _sum: { refundedTwd: true } }),
    db.usageLedger.aggregate({ where: { settledAt: { gte: day } }, _sum: { settledTwd: true }, _count: { _all: true } }),
    db.user.count(),
  ]);
  return {
    activeSubscriptions: subs,
    revenue30: revenue._sum.amountTwd ?? 0,
    refunds30: refunds._sum.refundedTwd ?? 0,
    relayCalls24h: relay._count._all,
    relayCost24h: Number(relay._sum.settledTwd ?? 0),
    users,
  };
}

export type InboxKind = "skill" | "tool" | "report" | "screening" | "dispute" | "payment";
export type InboxItem = {
  kind: InboxKind;
  id: string;
  /** what it is: a skill/tool name, a task title, a payment amount */
  title: string;
  /** one line of context; keys into admin.inbox.* are resolved by the page */
  detail: { key: string; values?: Record<string, string | number> };
  since: Date;
  href: string;
};

/** Waiting longer than this is shown as late */
export const LATE_MS = 24 * 3600_000;

/**
 * Everything waiting for an admin, oldest first: skill and tool versions to review, open reports, proposals in
 * screening, disputed crowdfunded tasks and payments nobody has heard back about.
 */
export async function adminInbox(now = new Date()): Promise<InboxItem[]> {
  const stale = new Date(now.getTime() - 15 * 60_000);
  const [skills, tools, reports, screening, disputes, payments] = await Promise.all([
    db.skillVersion.findMany({ where: { status: "PENDING_REVIEW" }, include: { skill: { include: { publisher: true } } }, orderBy: { publishedAt: "asc" }, take: 50 }),
    db.toolVersion.findMany({ where: { status: "PENDING_REVIEW" }, include: { tool: { include: { owner: true } } }, orderBy: { publishedAt: "asc" }, take: 50 }),
    db.report.findMany({ where: { resolvedAt: null }, include: { reporter: true }, orderBy: { createdAt: "asc" }, take: 50 }),
    db.task.findMany({ where: { status: "SCREENING" }, orderBy: { updatedAt: "asc" }, take: 50 }),
    db.task.findMany({ where: { status: "DISPUTED" }, orderBy: { updatedAt: "asc" }, take: 50 }),
    db.payment.findMany({ where: { status: "PENDING", provider: { not: "TWDC" }, createdAt: { lt: stale } }, include: { user: true }, orderBy: { createdAt: "asc" }, take: 50 }),
  ]);
  const handle = (u: { handle: string | null; publisher?: string | null; account: string }) => u.handle ?? u.publisher ?? u.account.slice(0, 10);
  const targets = await reportTargets(reports);
  const items: InboxItem[] = [
    ...skills.map((v): InboxItem => {
      const findings = (v.scanFindings as unknown[]).length;
      return {
        kind: "skill", id: v.id, title: `${v.skill.publisher.publisher}/${v.skill.name}@${v.version}`, since: v.publishedAt,
        detail: findings ? { key: "scanFindings", values: { n: findings } } : { key: "scanClean" }, href: `/admin?tab=review&id=${v.id}`,
      };
    }),
    ...tools.map((v): InboxItem => {
      const findings = (v.scanFindings as unknown[]).length;
      return {
        kind: "tool", id: v.id, title: `${v.tool.owner.publisher ?? handle(v.tool.owner)}/${v.tool.name}@${v.version}`, since: v.publishedAt,
        detail: findings ? { key: "scanFindings", values: { n: findings } } : { key: "scanClean" }, href: `/admin?tab=review&kind=tool&id=${v.id}`,
      };
    }),
    ...reports.map((r): InboxItem => ({
      kind: "report", id: r.id, title: targets.get(`${r.targetType}:${r.targetId}`)?.title ?? r.targetId, since: r.createdAt,
      detail: { key: `report.${r.targetType}`, values: { who: handle(r.reporter), reason: r.reason.slice(0, 120) } }, href: `/admin?tab=reports#report-${r.id}`,
    })),
    ...screening.map((t): InboxItem => {
      const sc = (t.screening ?? {}) as { decision?: string; aiDecision?: string; passed?: number; total?: number };
      return {
        kind: "screening", id: t.id, title: t.title, since: t.updatedAt,
        detail: sc.decision === "review" ? { key: sc.aiDecision === "approve" ? "aiApprove" : "aiReject", values: { passed: sc.passed ?? 0, total: sc.total ?? 0 } } : { key: "screeningBusy" },
        href: `/admin?tab=crowd#task-${t.id}`,
      };
    }),
    ...disputes.map((t): InboxItem => ({
      kind: "dispute", id: t.id, title: t.title, since: t.updatedAt,
      detail: { key: "dispute", values: { note: (t.reworkNotes ?? "").slice(0, 120) } }, href: `/admin?tab=crowd#task-${t.id}`,
    })),
    ...payments.map((p): InboxItem => ({
      kind: "payment", id: p.id, title: `@${handle(p.user)} NT$${(p.amountTwd ?? 0).toLocaleString("en-US")}`, since: p.createdAt,
      detail: { key: `payment.${p.purpose}` }, href: `/admin?tab=payments&id=${p.id}`,
    })),
  ];
  return items.sort((a, b) => a.since.getTime() - b.since.getTime());
}

/** Numbers under the headline figures */
export async function adminStatsDetail(now = new Date()) {
  const day = new Date(now.getTime() - 86400_000);
  const week = new Date(now.getTime() - 7 * 86400_000);
  const since = new Date(now.getTime() - 30 * 86400_000);
  const [subs, errors, newUsers, payments30, refunds30] = await Promise.all([
    db.subscription.findMany({ where: { cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, select: { plan: true } }),
    db.usageLedger.count({ where: { createdAt: { gte: day }, error: { not: null } } }),
    db.user.count({ where: { createdAt: { gte: week } } }),
    db.payment.count({ where: { status: { in: ["CONFIRMED", "REFUNDED"] }, provider: { not: "TWDC" }, sandbox: false, confirmedAt: { gte: since } } }),
    db.payment.count({ where: { refundedAt: { gte: since }, sandbox: false } }),
  ]);
  const byPlan: Record<string, number> = {};
  for (const s of subs) byPlan[s.plan] = (byPlan[s.plan] ?? 0) + 1;
  return { subsByPlan: byPlan, relayErrors24h: errors, newUsers7d: newUsers, payments30, refunds30Count: refunds30 };
}

/** The latest admin actions, for the overview */
export async function recentAudit(n = 5) {
  return db.adminAudit.findMany({ include: { actor: true }, orderBy: { createdAt: "desc" }, take: n });
}
