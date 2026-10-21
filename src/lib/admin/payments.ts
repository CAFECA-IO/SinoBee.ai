import { db, icontains } from "../db";

/** Payments in /admin: search, status counts, a period, and the same rows as CSV */

export const PAY_STATUSES = ["PENDING", "CONFIRMED", "FAILED", "EXPIRED", "REFUNDED"] as const;
export type PayStatus = (typeof PAY_STATUSES)[number];
export const PAY_PERIODS = [7, 30, 90, 0] as const; // 0 = all time
const DAY = 86400_000;

export type PaymentQuery = { status?: PayStatus; q?: string; days?: number };

export function paymentWhere(f: PaymentQuery, now = new Date()) {
  const q = f.q?.trim();
  return {
    provider: { not: "TWDC" as const },
    ...(f.days ? { createdAt: { gte: new Date(now.getTime() - f.days * DAY) } } : {}),
    ...(q
      ? {
          OR: [
            { id: q },
            { transactionHid: q },
            { oenId: q },
            { taskId: q },
            { user: { account: icontains(q.toLowerCase()) } },
            { user: { handle: icontains(q.replace(/^@/, "")) } },
            { user: { publisher: icontains(q.replace(/^@/, "")) } },
          ],
        }
      : {}),
  };
}

export async function paymentList(f: PaymentQuery, now = new Date(), take = 100) {
  const base = paymentWhere(f, now);
  const [rows, counts] = await Promise.all([
    db.payment.findMany({ where: { ...base, ...(f.status ? { status: f.status } : {}) }, include: { user: true }, orderBy: { createdAt: "desc" }, take }),
    db.payment.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(PAY_STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count._all ?? 0])) as Record<PayStatus, number>;
  return { rows, counts: byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0) };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // keep spreadsheet apps from running a cell as a formula
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const PAYMENT_CSV_HEADER = ["created_at", "confirmed_at", "id", "user", "account", "purpose", "amount_twd", "refunded_twd", "status", "provider", "test", "transaction", "task", "error"];

export async function paymentsCsv(f: PaymentQuery, now = new Date()) {
  const rows = await db.payment.findMany({
    where: { ...paymentWhere(f, now), ...(f.status ? { status: f.status } : {}) },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 10_000,
  });
  const lines = [PAYMENT_CSV_HEADER.join(",")];
  for (const p of rows)
    lines.push(
      [p.createdAt, p.confirmedAt, p.id, p.user.handle ?? p.user.publisher ?? "", p.user.account, p.purpose, p.amountTwd ?? "", p.refundedTwd, p.status, p.provider, p.sandbox ? "1" : "", p.transactionHid ?? "", p.taskId ?? "", p.error ?? ""]
        .map(cell)
        .join(","),
    );
  return "﻿" + lines.join("\r\n") + "\r\n";
}
