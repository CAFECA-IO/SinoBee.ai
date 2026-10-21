import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { PAY_STATUSES, type PayStatus, paymentsCsv } from "@/lib/admin/payments";
import { audit } from "@/lib/roles";

/** The payments the admin list shows (same filters), as CSV */
export const GET = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const u = new URL(req.url);
  const s = u.searchParams.get("status") ?? "";
  const status = (PAY_STATUSES as readonly string[]).includes(s) ? (s as PayStatus) : undefined;
  const days = Number(u.searchParams.get("days") ?? 0) || undefined;
  const q = u.searchParams.get("q") ?? undefined;
  const csv = await paymentsCsv({ status, q, days });
  await audit(admin.id, "payments.export", undefined, { status: status ?? null, q: q ?? null, days: days ?? null });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sinobee-payments-${stamp}.csv"`, "cache-control": "no-store" } });
});
