/** Settle Oen payments whose webhook was missed and expire abandoned checkouts (the worker also does this every 3 min) */
import "dotenv/config";
import { reconcilePayments } from "../src/lib/payments";

reconcilePayments()
  .then((r) => {
    console.log(`checked ${r.checked} pending payments, settled ${r.settled}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
