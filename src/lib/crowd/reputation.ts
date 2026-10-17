import { db } from "../db";

/**
 * A proposer's track record, shown next to their campaigns: how many reached their goal, how many results were
 * accepted (and accepted the first time), platform refunds, and the CAFECA KYC level. Backed tasks count too.
 */
export type Reputation = {
  opened: number;
  /** campaigns that have ended (funded or not) — the base of the success rate */
  decided: number;
  funded: number;
  unfunded: number;
  accepted: number;
  firstPass: number;
  refunded: number;
  backed: number;
  kycLevel: number | null;
  /** new | rising | trusted */
  badge: "new" | "rising" | "trusted";
};

export async function reputation(userId: string): Promise<Reputation> {
  const [rows, backed, user] = await Promise.all([
    db.task.findMany({ where: { userId, crowdfund: true, fundingStartedAt: { not: null }, takenDownAt: null }, select: { status: true, fundedAt: true, reworks: true, error: true } }),
    db.pledge.findMany({ where: { userId, status: "CHARGED" }, select: { taskId: true }, distinct: ["taskId"] }),
    db.user.findUnique({ where: { id: userId }, select: { kycLevel: true } }),
  ]);
  const funded = rows.filter((r) => r.fundedAt).length;
  const unfunded = rows.filter((r) => r.status === "UNFUNDED").length;
  const accepted = rows.filter((r) => r.fundedAt && r.status === "COMPLETED").length;
  const firstPass = rows.filter((r) => r.fundedAt && r.status === "COMPLETED" && r.reworks === 0).length;
  const refunded = rows.filter((r) => r.status === "FAILED" && (r.error ?? "").startsWith("Refunded by the platform")).length;
  const badge = accepted >= 3 && refunded === 0 ? "trusted" : accepted >= 1 ? "rising" : "new";
  return { opened: rows.length, decided: funded + unfunded, funded, unfunded, accepted, firstPass, refunded, backed: backed.length, kycLevel: user?.kycLevel ?? null, badge };
}
