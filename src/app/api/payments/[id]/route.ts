import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { syncPayment } from "@/lib/payments";

const lastSync = new Map<string, number>();

/** Status of one of my payments; pending Oen payments are re-read from Oen (at most every 3 s per payment) */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  let p = await db.payment.findUnique({ where: { id: (await ctx.params).id } });
  if (!p || p.userId !== user.id) return json({ error: "not found" }, 404);
  if (p.status === "PENDING" && p.provider === "OEN" && Date.now() - (lastSync.get(p.id) ?? 0) > 3000) {
    lastSync.set(p.id, Date.now());
    const cur = p;
    p = await syncPayment(cur.id).catch(() => cur);
  }
  return json({ id: p.id, status: p.status, purpose: p.purpose, amount: p.amountTwd, taskId: p.taskId, providerStatus: p.providerStatus });
});
