import { db } from "./db";
import { config } from "./config";
import { hubPublicKeys } from "./skills/signing";
import { resolve } from "./settings/cache";
import { SETTINGS } from "./settings/registry";

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
  return { pending: skills, tools, reports, payments, disputes, screening, settings: settingsHealth().filter((c) => !c.ok && c.level === "error").length };
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
