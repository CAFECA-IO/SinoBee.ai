import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { createPayment } from "@/lib/payments";

/** Add funds to a task (any non-final state); NEEDS_FUNDING tasks resume once the payment is confirmed */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { amount } = z.object({ amount: z.coerce.number().positive() }).parse(await req.json());
  const t = await db.task.findUnique({ where: { id } });
  if (!t || t.userId !== user.id) return json({ error: "not found" }, 404);
  const min = t.status === "AWAITING_PAYMENT" ? config.payments.minTaskBudget : config.payments.minTopUp;
  if (amount < min) return json({ error: `minimum amount is ${min} TWD` }, 400);
  if (!["AWAITING_PAYMENT", "NEEDS_FUNDING", "RUNNING", "QUEUED"].includes(t.status)) return json({ error: "task is not running or waiting for funds" }, 400);
  const purpose = t.status === "AWAITING_PAYMENT" ? "TASK_BUDGET" : "TASK_TOPUP";
  const payment = await createPayment({ userId: user.id, purpose, amount: amount.toFixed(6), taskId: id });
  return json({ payment });
});
