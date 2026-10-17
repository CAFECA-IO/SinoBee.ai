import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { config } from "@/lib/config";
import { OenError, orderTransactions } from "@/lib/oen";

/**
 * Check the Oen settings without moving money: list the transactions of an order id that does not exist.
 * S0000 (or "not found" V0001) means the token, domain and network path all work.
 */
export const POST = handle(async () => {
  await requireAdmin();
  try {
    // the credentials in use now (the test ones while the site is in test mode)
    await orderTransactions(`connectivity-check-${Date.now()}`, config.testMode);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof OenError && e.code === "V0001") return json({ ok: true });
    return json({ ok: false, error: (e as Error).message });
  }
});
