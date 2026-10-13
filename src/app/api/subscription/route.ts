import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { createPayment } from "@/lib/payments";

export const POST = handle(async () => {
  const user = await requireUser();
  const payment = await createPayment({ userId: user.id, purpose: "SUBSCRIPTION", amount: config.subscription.priceTwdc.toFixed(6), meta: { days: config.subscription.days } });
  return json({ payment });
});
