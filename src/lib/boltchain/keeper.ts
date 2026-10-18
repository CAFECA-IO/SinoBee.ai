import { config } from "../config";
import { db } from "../db";
import { mirrorDelete, mirrorGet } from "../storage";
import { siteAccount, publicClient, SWARM, swarmAbi, walletClient, currentEpoch, assertNodeReady, nodeProblem } from "./chain";
import { wrapKey } from "./keys";
import { cancelDeal, closeDeal, extendDeal, storeSealed, MAX_DEAL_EPOCHS, dealInfo, epochsUntil, openSlots } from "./swarm";
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
      if (o.keepUntil && o.keepUntil < new Date()) {
        // expired before it was stored (e.g. a share that ran out): nothing to keep
        await db.storageObject.update({ where: { key: o.key }, data: { status: "DELETED", recipientKey: null, deletedAt: new Date() } });
        await mirrorDelete(o.key);
        continue;
      }
      const epochs = o.keepUntil ? epochsUntil(o.keepUntil) : BigInt(config.boltchain.epochs);
      const r = await storeSealed(new Uint8Array(bytes), o.key.split("/").pop() || "object", o.contentType, {
        replicas: o.wantReplicas ?? config.boltchain.replicas,
        epochs: epochs > MAX_DEAL_EPOCHS ? MAX_DEAL_EPOCHS : epochs,
      });
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
  // keep-until reached: the deal may already be over — closeEnded settles it
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
  const rows = await db.storageObject.findMany({
    where: { status: "STORED", dealState: "active", endEpoch: { lte: soon }, OR: [{ keepUntil: null }, { keepUntil: { gt: new Date() } }] },
    take: limit,
  });
  for (const o of rows) {
    try {
      const d = await dealInfo(o.dealId!);
      const room = MAX_DEAL_EPOCHS - (d.endEpoch - d.startEpoch);
      let want = BigInt(config.boltchain.epochs);
      if (o.keepUntil) {
        // only as long as the object is meant to be kept
        const target = now + epochsUntil(o.keepUntil);
        want = target > d.endEpoch ? target - d.endEpoch : 0n;
        if (want === 0n) continue;
      }
      const epochs = want < room ? want : room;
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
    await assertNodeReady();
    const hash = await walletClient().writeContract({ address: SWARM, abi: swarmAbi, functionName: "withdraw", args: [me] });
    await publicClient().waitForTransactionReceipt({ hash });
    log(`withdrew ${bal} wei of refunds`);
  }
}

/** Objects past their keep-until date or retention period: destroy the key; the deal ends or is cancelled */
export async function expireObjects(limit = 50) {
  const now = new Date();
  const rows = await db.storageObject.findMany({
    where: { status: { in: ["PENDING", "STORED"] }, OR: [{ keepUntil: { lte: now } }, { deleteAfter: { lte: now } }] },
    take: limit,
  });
  for (const o of rows) {
    await mirrorDelete(o.key).catch(() => undefined);
    await db.storageObject.update({
      where: { key: o.key },
      // retention over → cancel now; keep-until reached → the deal was sized to end then, cancel what is left
      data: { status: "DELETED", recipientKey: null, deletedAt: now, mirrored: false, nextTryAt: now, attempts: 0 },
    });
    log(`expired ${o.key}`);
  }
}

/** Compare the database with the chain: re-store objects whose deal ended early or lost every copy */
export async function auditDeals(limit = 5) {
  const hourAgo = new Date(Date.now() - 3600_000);
  const rows = await db.storageObject.findMany({
    where: { status: "STORED", dealState: "active", OR: [{ lastAuditAt: null }, { lastAuditAt: { lt: hourAgo } }] },
    orderBy: { lastAuditAt: "asc" },
    take: limit,
  });
  if (!rows.length) return;
  const now = await currentEpoch();
  for (const o of rows) {
    try {
      const d = await dealInfo(o.dealId!);
      const copies = d.closed ? 0 : await openSlots(o.dealId!);
      const want = o.wantReplicas ?? config.boltchain.replicas;
      const ended = d.closed || d.endEpoch <= now || d.root !== o.dealRoot;
      if (ended || copies === 0) {
        if (!ended) await tombstone(o.dealId!);
        await db.storageObject.update({
          where: { key: o.key },
          data: { status: "PENDING", dealState: "none", nextTryAt: new Date(), attempts: 0, lastAuditAt: new Date(), error: ended ? `deal ${o.dealId} ended unexpectedly` : `deal ${o.dealId} lost every copy` },
        });
        log(`audit: re-storing ${o.key} (${ended ? "deal ended" : "no copies left"})`);
      } else {
        await db.storageObject.update({
          where: { key: o.key },
          data: { lastAuditAt: new Date(), endEpoch: d.endEpoch, error: copies < want ? `only ${copies} of ${want} copies are held` : null },
        });
      }
    } catch (e) {
      await db.storageObject.update({ where: { key: o.key }, data: { lastAuditAt: new Date(), error: msg(e) } });
    }
  }
}

/** Tell admins (once a day) when the site wallet runs low on BOLT */
export async function checkBalance() {
  const me = siteAccount().address;
  const bal = await publicClient().getBalance({ address: me });
  if (bal >= BigInt(config.boltchain.lowBalanceWei)) return bal;
  const since = new Date(Date.now() - 86400_000);
  const admins = await db.user.findMany({ where: { isAdmin: true } });
  const { notify } = await import("../notify");
  for (const a of admins) {
    if (await db.notification.count({ where: { userId: a.id, type: "storage.low_balance", createdAt: { gt: since } } })) continue;
    await notify(a.id, {
      type: "storage.low_balance",
      title: "Boltchain storage wallet is running low",
      body: `${me} holds ${Number(bal / 10n ** 15n) / 1000} BOLT. New objects stay in the mirror until it is topped up.`,
      link: "/admin?tab=storage",
    }).catch(() => undefined);
  }
  log(`low balance: ${bal} wei`);
  return bal;
}

// ---------- anchors (notarization) ----------

/**
 * Queue content hashes to be notarized (idempotent per target). Files are hashed now; nothing else is kept. With
 * `publicFiles` the content is read back from the target when the certificate is issued (see publicContent) and kept
 * on Boltchain for anyone to download.
 */
export async function requestAnchor(targetType: string, targetId: string, files: FileHash[], opts: { publicFiles?: boolean } = {}) {
  if (!config.boltchain.enabled || !config.boltchain.certificates) return null;
  const { newSalt } = await import("./certificates");
  const publicFiles = !!opts.publicFiles;
  const row = await db.anchor.upsert({
    where: { targetType_targetId: { targetType, targetId } },
    create: { targetType, targetId, salt: newSalt(), files: files as unknown as object, publicFiles },
    update: {},
  });
  // a request made public before it was issued
  if (publicFiles && !row.publicFiles && row.status === "pending") return db.anchor.update({ where: { id: row.id }, data: { publicFiles: true } });
  return row;
}

/** The exact bytes of a public anchor's files, in order (only targets whose content is meant to be public) */
async function publicContent(targetType: string, targetId: string): Promise<Uint8Array[]> {
  if (targetType === "legal") {
    const v = await db.legalVersion.findUniqueOrThrow({ where: { id: targetId }, select: { markdown: true } });
    return [new TextEncoder().encode(v.markdown)];
  }
  throw new Error(`${targetType} cannot be published`);
}

export async function anchorPending(limit = 4) {
  if (!config.boltchain.certificates) return;
  const rows = await db.anchor.findMany({ where: { status: "pending", nextTryAt: { lte: new Date() } }, take: limit });
  for (const a of rows) {
    const lease = await db.anchor.updateMany({ where: { id: a.id, status: "pending", nextTryAt: a.nextTryAt }, data: { nextTryAt: new Date(Date.now() + 15 * 60_000) } });
    if (lease.count !== 1) continue;
    try {
      const r = await issue(a.files as unknown as FileHash[], a.salt as `0x${string}`, a.publicFiles ? await publicContent(a.targetType, a.targetId) : undefined);
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
  if (targetType === "skill-version") await db.skillVersion.updateMany({ where: { id: targetId }, data: { anchorCode: code } });
  if (targetType === "legal") await db.legalVersion.updateMany({ where: { id: targetId }, data: { anchorCode: code } });
}

let lastProblem: string | null = null;

/**
 * One pass of every job; each job's failure is logged and does not stop the others. Jobs that send transactions are
 * skipped while the node is not ready (see nodeProblem), so objects keep their retry schedule instead of collecting
 * timeouts and "nonce too high" errors; the problem is shown on the admin storage page.
 */
export async function keeperTick() {
  if (!config.boltchain.enabled) return;
  let problem: string | null;
  try {
    problem = await nodeProblem();
  } catch (e) {
    problem = `Boltchain node unreachable: ${msg(e)}`;
  }
  if (problem !== lastProblem) log(problem ? `paused: ${problem}` : "node ready again");
  if (!problem && lastProblem) await retryNow();
  lastProblem = problem;
  const jobs = [["expire", expireObjects], ["store", storePending], ["anchor", anchorPending], ["cancel", cancelDeleted], ["renew", renewDeals], ["close", closeEnded], ["audit", auditDeals], ["balance", checkBalance]] as const;
  const sends = new Set(["store", "anchor", "cancel", "renew", "close"]);
  for (const [name, job] of jobs) {
    if (problem && sends.has(name)) continue;
    try {
      await job();
    } catch (e) {
      log(`${name}: ${msg(e)}`);
    }
  }
}

/** Objects and anchors that failed while the node was not ready: try them again now instead of after their backoff */
export async function retryNow() {
  const now = new Date();
  const a = await db.storageObject.updateMany({ where: { status: "PENDING", error: { not: null } }, data: { nextTryAt: now, attempts: 0 } });
  const b = await db.anchor.updateMany({ where: { status: "pending", error: { not: null } }, data: { nextTryAt: now, attempts: 0 } });
  if (a.count + b.count) log(`retrying ${a.count} objects and ${b.count} anchors now`);
  return { objects: a.count, anchors: b.count };
}

/** Status for the admin page */
export async function storageStatus() {
  const groups = await db.storageObject.groupBy({ by: ["status"], _count: { _all: true }, _sum: { size: true } });
  const base = { enabled: config.boltchain.enabled, certificates: config.boltchain.certificates || null, explorer: config.boltchain.explorer, groups };
  if (!config.boltchain.enabled) return base;
  try {
    const me = siteAccount().address;
    const [balance, epoch, problem] = await Promise.all([publicClient().getBalance({ address: me }), currentEpoch(), nodeProblem()]);
    return { ...base, wallet: me, balance: balance.toString(), epoch: epoch.toString(), low: balance < BigInt(config.boltchain.lowBalanceWei), ...(problem ? { error: problem } : {}) };
  } catch (e) {
    return { ...base, error: msg(e) };
  }
}

