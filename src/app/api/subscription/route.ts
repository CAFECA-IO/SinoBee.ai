import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { createPayment } from "@/lib/payments";
import { BuyerInput } from "@/lib/buyer-schema";

/** Buy (or extend with) a plan: returns the Oen checkout URL. The new period stacks after the current one. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const b = z.object({ planId: z.string(), buyer: BuyerInput }).parse(await req.json());
  const plan = await db.plan.findUnique({ where: { id: b.planId } });
  if (!plan || !plan.active) return json({ error: "plan not available" }, 404);
  const pay = await createPayment({ userId: user.id, purpose: "SUBSCRIPTION", amountTwd: Number(plan.feeTwd), planId: plan.id, buyer: b.buyer });
  return json({ payment: pay });
});
