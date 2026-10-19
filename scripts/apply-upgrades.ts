/**
 * One-off: subscriptions bought before upgrades took effect immediately.
 * For every user whose running period is on a cheaper plan than a period queued after it, start that more expensive
 * period now (the running one ends, its unused time is converted to extra days at equal value, the rest move up).
 *
 *   npx tsx scripts/apply-upgrades.ts            # dry run: lists what would change
 *   npx tsx scripts/apply-upgrades.ts --apply    # apply
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { upgradeNow } from "../src/lib/subscriptions";

const apply = process.argv.includes("--apply");
const now = new Date();
const fee = async (s: { planId: string | null; plan: string }) =>
  Number(((s.planId ? await db.plan.findUnique({ where: { id: s.planId } }) : null) ?? (await db.plan.findUnique({ where: { code: s.plan } })))?.feeTwd ?? 0);

async function main() {
  const running = await db.subscription.findMany({ where: { cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, include: { user: true } });
  let n = 0;
  for (const cur of running) {
    const queued = await db.subscription.findMany({ where: { userId: cur.userId, cancelledAt: null, startsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
    const curFee = await fee(cur);
    for (const q of queued) {
      if ((await fee(q)) <= curFee) continue;
      n++;
      console.log(`${cur.user.account}: ${cur.plan} (until ${cur.endsAt.toISOString()}) → ${q.plan} now (queued from ${q.startsAt.toISOString()})`);
      if (apply) {
        const up = await upgradeNow(cur.userId, q.id, now);
        console.log(up ? `  done: ${up.plan} ${up.startsAt.toISOString()} – ${up.endsAt.toISOString()}` : "  skipped");
      }
      break; // one upgrade per user
    }
  }
  console.log(n ? (apply ? `${n} upgraded` : `${n} to upgrade — run again with --apply`) : "nothing to upgrade");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
