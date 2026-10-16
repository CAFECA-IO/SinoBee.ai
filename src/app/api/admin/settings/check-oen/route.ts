import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { OenError, orderTransactions } from "@/lib/oen";

/**
 * Check the Oen settings without moving money: list the transactions of an order id that does not exist.
 * S0000 (or "not found" V0001) means the token, domain and network path all work.
 */
export const POST = handle(async () => {
  await requireAdmin();
  try {
    await orderTransactions(`connectivity-check-${Date.now()}`);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof OenError && e.code === "V0001") return json({ ok: true });
    return json({ ok: false, error: (e as Error).message });
  }
});
