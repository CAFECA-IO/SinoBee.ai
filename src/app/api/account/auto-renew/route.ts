import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { BuyerInput } from "@/lib/buyer-schema";
import { autoRenewState, setAutoRenew } from "@/lib/auto-renew";

/** Automatic renewal: the user's setting and when the next charge is due */
export const GET = handle(async () => {
  const user = await requireUser();
  return json(await autoRenewState(user.id));
});

/** Turn automatic renewal on (a saved card; the e-invoice buyer, or the last one used) or off */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const b = z.object({ on: z.boolean(), cardId: z.string().max(40).optional(), buyer: BuyerInput.optional() }).parse(await req.json());
  return json(await setAutoRenew(user.id, b.on, { cardId: b.cardId, buyer: b.buyer }));
});
