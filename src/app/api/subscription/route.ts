import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { createPayment } from "@/lib/payments";
import { BuyerInput } from "@/lib/buyer-schema";
import { setAutoRenew } from "@/lib/auto-renew";

/**
 * Buy (or extend with) a plan, charged to a saved card. The new period stacks after the current one. autoRenew: the
 * buyer also turned on automatic renewal with this card (off unless ticked).
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const b = z.object({ planId: z.string(), buyer: BuyerInput, cardId: z.string().max(40), autoRenew: z.boolean().default(false) }).parse(await req.json());
  const plan = await db.plan.findUnique({ where: { id: b.planId } });
  if (!plan || !plan.active) return json({ error: "plan not available" }, 404);
  const pay = await createPayment({ userId: user.id, purpose: "SUBSCRIPTION", amountTwd: Number(plan.feeTwd), planId: plan.id, buyer: b.buyer, cardId: b.cardId });
  if (b.autoRenew) await setAutoRenew(user.id, true, { cardId: b.cardId, buyer: b.buyer });
  return json({ payment: { id: pay.id, status: pay.status }, autoRenew: b.autoRenew });
});
