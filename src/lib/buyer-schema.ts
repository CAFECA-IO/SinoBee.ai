import { z } from "zod";

/** Buyer details sent to Oen for the e-invoice (validated again in payments.cleanBuyer) */
export const BuyerInput = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(200),
  invoice: z
    .discriminatedUnion("invoiceType", [
      z.object({ invoiceType: z.literal("cloud"), carrierType: z.enum(["", "3J0002", "CQ0001"]).default(""), carrierId: z.string().trim().max(20).optional() }),
      z.object({ invoiceType: z.literal("company"), buyerIdentifier: z.string().trim().max(8), buyerName: z.string().trim().max(60).optional() }),
    ])
    .optional(),
});
