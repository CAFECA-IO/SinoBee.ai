import { config } from "../config";
import { db } from "../db";
import { mirrorDelete, mirrorGet } from "../storage";
import { siteAccount, publicClient, SWARM, swarmAbi, walletClient, currentEpoch } from "./chain";
import { wrapKey } from "./keys";
import { cancelDeal, closeDeal, extendDeal, storeSealed, MAX_DEAL_EPOCHS, dealInfo } from "./swarm";
import { issue, type FileHash } from "./certificates";

/**
 * Storage keeper (run by the worker every minute, or `npm run storage-keeper`):
 *  1. store   — seal PENDING objects with bolt-vault and pay a SwarmStorage deal (the site pays, decision 1)
 *  2. anchor  — notarize content hashes with the Certificates contract (decision 3)
 *  3. renew   — extend deals that are about to end
 *  4. cancel  — cancel deals of deleted objects (their keys are already destroyed)
 *  5. close   — close ended deals so unused escrow is refunded, then withdraw refunds
 */
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[storage]", ...a);
const backoff = (attempts: number) => new Date(Date.now() + Math.min(6 * 3600, 60 * 2 ** Math.min(attempts, 10)) * 1000);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 500);

export async function storePending(limit = 4) {
  const rows = await db.storageObject.findMany({ where: { status: "PENDING", nextTryAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: limit });
  let done = 0;
  for (const o of rows) {
    // lease: several workers may run the keeper; only the one that moves nextTryAt stores the object
    const lease = await db.storageObject.updateMany({ where: { key: o.key, status: "PENDING", nextTryAt: o.nextTryAt }, data: { nextTryAt: new Date(Date.now() + 15 * 60_000) } });
    if (lease.count !== 1) continue;
    try {
      const bytes = await mirrorGet(o.key);
      const r = await storeSealed(new Uint8Array(bytes), o.key.split("/").pop() || "object", o.contentType);
      const keep = config.boltchain.mirror;
      // the row may have been deleted or overwritten while we were storing it
      const upd = await db.storageObject.updateMany({
        where: { key: o.key, status: "PENDING", sha256: o.sha256 },
        data: {
          status: "STORED", envelopeCid: r.envelope, dealRoot: r.root, dealId: r.dealId, dealState: "active", blocks: r.blocks, dealSize: r.size,
          replicas: r.replicas, endEpoch: r.endEpoch, paidWei: r.paid.toString(), txHash: r.txHash, recipientKey: wrapKey(r.secretKey, o.key),
          error: null, mirrored: keep,
        },
      });
      if (upd.count === 0) {
        await tombstone(r.dealId);
        continue;
      }
      if (!keep) await mirrorDelete(o.key);
      done++;
      log(`stored ${o.key} → deal ${r.dealId} (${r.replicas} copies, ${r.size} bytes)`);
    } catch (e) {
      await db.storageObject.update({ where: { key: o.key }, data: { attempts: { increment: 1 }, nextTryAt: backoff(o.attempts + 1), error: msg(e) } });
      log(`store ${o.key} failed: ${msg(e)}`);
    }
  }
  return done;
}

async function tombstone(dealId: bigint) {
  await db.storageObject.create({ data: { key: `_cancel/${dealId}`, kind: "_cancel", size: 0n, sha256: "", keccak: "", status: "DELETED", dealId, dealState: "active", deletedAt: new Date(), mirrored: false } }).catch(() => undefined);
}

export async function cancelDeleted(limit = 10) {
  const rows = await db.storageObject.findMany({ where: { status: "DELETED", dealId: { not: null }, dealState: "active", nextTryAt: { lte: new Date() } }, take: limit });
  for (const o of rows) {
    try {
      await cancelDeal(o.dealId!);
      const now = await currentEpoch();
      await db.storageObject.update({ where: { key: o.key }, data: { dealState: "cancelled", endEpoch: now + 1n, error: null } });
      log(`cancelled deal ${o.dealId} (${o.key})`);
    } catch (e) {
      const m = msg(e);
      // already over (or not ours any more): nothing left to cancel
      if (/DealOver|NotOwner/.test(m)) await db.storageObject.update({ where: { key: o.key }, data: { dealState: "cancelled" } });
      else await db.storageObject.update({ where: { key: o.key }, data: { attempts: { increment: 1 }, nextTryAt: backoff(o.attempts + 1), error: m } });
    }
  }
}

export async function renewDeals(limit = 10) {
  const now = await currentEpoch();
  const soon = now + BigInt(config.boltchain.renewBelow);
  const rows = await db.storageObject.findMany({ where: { status: "STORED", dealState: "active", endEpoch: { lte: soon } }, take: limit });
  for (const o of rows) {
    try {
      const d = await dealInfo(o.dealId!);
      const room = MAX_DEAL_EPOCHS - (d.endEpoch - d.startEpoch);
      const epochs = BigInt(config.boltchain.epochs) < room ? BigInt(config.boltchain.epochs) : room;
      if (epochs > 0n && d.endEpoch > now) {
        await extendDeal(o.dealId!, epochs);
        await db.storageObject.update({ where: { key: o.key }, data: { endEpoch: d.endEpoch + epochs, error: null } });
        log(`extended deal ${o.dealId} by ${epochs} epochs (${o.key})`);
      } else {
        // the deal cannot grow any more (or already ended): store the object again under a new deal
        await tombstone(o.dealId!);
        await db.storageObject.update({ where: { key: o.key }, data: { status: "PENDING", dealState: "none", nextTryAt: new Date(), attempts: 0 } });
        log(`re-storing ${o.key}: deal ${o.dealId} reached its limit`);
      }
    } catch (e) {
      await db.storageObject.update({ where: { key: o.key }, data: { error: msg(e) } });
    }
  }
}

export async function closeEnded(limit = 10) {
  const now = await currentEpoch();
  const rows = await db.storageObject.findMany({ where: { dealState: "cancelled", endEpoch: { lte: now } }, take: limit });
  for (const o of rows) {
    try {
      await closeDeal(o.dealId!);
    } catch (e) {
      if (!/BadDeal/.test(msg(e))) continue; // BadDeal: closed already
    }
    await db.storageObject.update({ where: { key: o.key }, data: { dealState: "closed" } });
    if (o.kind === "_cancel") await db.storageObject.delete({ where: { key: o.key } });
  }
  // refunds of closed deals accumulate in SwarmStorage.balanceOf(site)
  const me = siteAccount().address;
  const bal = await publicClient().readContract({ address: SWARM, abi: swarmAbi, functionName: "balanceOf", args: [me] });
  if (bal > 0n) {
    const hash = await walletClient().writeContract({ address: SWARM, abi: swarmAbi, functionName: "withdraw", args: [me] });
    await publicClient().waitForTransactionReceipt({ hash });
    log(`withdrew ${bal} wei of refunds`);
  }
}

// ---------- anchors (notarization) ----------

/** Queue content hashes to be notarized (idempotent per target). Files are hashed now; nothing else is kept. */
export async function requestAnchor(targetType: string, targetId: string, files: FileHash[]) {
  if (!config.boltchain.enabled || !config.boltchain.certificates) return null;
  const { newSalt } = await import("./certificates");
  return db.anchor.upsert({
    where: { targetType_targetId: { targetType, targetId } },
    create: { targetType, targetId, salt: newSalt(), files: files as unknown as object },
    update: {},
  });
}

export async function anchorPending(limit = 4) {
  if (!config.boltchain.certificates) return;
  const rows = await db.anchor.findMany({ where: { status: "pending", nextTryAt: { lte: new Date() } }, take: limit });
  for (const a of rows) {
    const lease = await db.anchor.updateMany({ where: { id: a.id, status: "pending", nextTryAt: a.nextTryAt }, data: { nextTryAt: new Date(Date.now() + 15 * 60_000) } });
    if (lease.count !== 1) continue;
    try {
      const r = await issue(a.files as unknown as FileHash[], a.salt as `0x${string}`);
      await db.anchor.update({ where: { id: a.id }, data: { code: r.code, root: r.root, txHash: r.txHash, status: "issued", issuedAt: new Date(), error: null } });
      await onAnchored(a.targetType, a.targetId, r.code);
      log(`anchored ${a.targetType}/${a.targetId} → ${r.code}`);
    } catch (e) {
      await db.anchor.update({ where: { id: a.id }, data: { attempts: { increment: 1 }, nextTryAt: backoff(a.attempts + 1), error: msg(e) } });
      log(`anchor ${a.targetType}/${a.targetId} failed: ${msg(e)}`);
    }
  }
}

async function onAnchored(targetType: string, targetId: string, code: string) {
  if (targetType === "tool-version") await db.toolVersion.updateMany({ where: { id: targetId }, data: { anchorCode: code } });
  if (targetType === "share") await db.conversationShare.updateMany({ where: { id: targetId }, data: { anchorCode: code } });
}

/** One pass of every job; each job's failure is logged and does not stop the others. */
export async function keeperTick() {
  if (!config.boltchain.enabled) return;
  for (const [name, job] of [["store", storePending], ["anchor", anchorPending], ["cancel", cancelDeleted], ["renew", renewDeals], ["close", closeEnded]] as const) {
    try {
      await job();
    } catch (e) {
      log(`${name}: ${msg(e)}`);
    }
  }
}

/** Status for the admin page */
export async function storageStatus() {
  const groups = await db.storageObject.groupBy({ by: ["status"], _count: { _all: true }, _sum: { size: true } });
  const base = { enabled: config.boltchain.enabled, certificates: config.boltchain.certificates || null, explorer: config.boltchain.explorer, groups };
  if (!config.boltchain.enabled) return base;
  try {
    const me = siteAccount().address;
    const [balance, epoch] = await Promise.all([publicClient().getBalance({ address: me }), currentEpoch()]);
    return { ...base, wallet: me, balance: balance.toString(), epoch: epoch.toString() };
  } catch (e) {
    return { ...base, error: msg(e) };
  }
}

