import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";

/**
 * The TWDC subscription is closed: plans are now defined in the admin backend (Plan table) and will be paid
 * through Oen in TWD. Existing subscriptions keep running until they end.
 */
export const POST = handle(async () => {
  await requireUser();
  return json({ error: "subscriptions are moving to Oen payments; see /pricing#plans" }, 410);
});
