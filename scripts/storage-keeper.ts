/** One storage-keeper pass (or `--loop`): store pending objects on Boltchain, notarize, renew, cancel, close. */
import "dotenv/config";
import { config } from "../src/lib/config";
import { keeperTick, storageStatus } from "../src/lib/boltchain/keeper";

async function main() {
  if (!config.boltchain.enabled) {
    console.error("Boltchain storage is off: set BOLT_RPC_URL, BOLT_WALLET_KEY and BOLT_MASTER_KEY");
    process.exit(1);
  }
  do {
    await keeperTick();
    if (!process.argv.includes("--loop")) break;
    await new Promise((r) => setTimeout(r, 30_000));
  } while (true);
  console.log(JSON.stringify(await storageStatus(), (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  process.exit(0);
}
main();
