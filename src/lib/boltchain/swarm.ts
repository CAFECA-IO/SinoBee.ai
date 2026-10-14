import { decodeEventLog, hexToBytes, toHex, type Hex } from "viem";
import { config } from "../config";
import { checkBlock, cidToBytes, cidFromBytes, type Block } from "./cid";
import { buildDealIndex, decodeDealIndex } from "./deal-index";
import { SWARM, currentEpoch, publicClient, rpc, swarmAbi, walletClient } from "./chain";
import * as vault from "./vault";

/** SwarmStorage (Boltchain ADR 0014): seal → host blocks on our node → createDeal; read back with bolt_getBlocks. */
const HOST_BATCH = 4 << 20;
const GET_BATCH = 64;
export const MAX_DEAL_EPOCHS = 3650n;

export const perEpoch = (price: bigint, size: bigint) => (price * ((size + (1n << 20n) - 1n) >> 20n) + 1023n) / 1024n;

export type Quote = { replicas: number; price: bigint; epochs: bigint; cost: bigint; offers: number };

/** Copies and price from the open offers: the n-th cheapest minimum price, so n providers can be drawn. */
export async function quote(size: bigint, epochs = BigInt(config.boltchain.epochs)): Promise<Quote> {
  const pc = publicClient();
  const mib = (size + (1n << 20n) - 1n) >> 20n;
  const ids = await pc.readContract({ address: SWARM, abi: swarmAbi, functionName: "offerList" });
  const prices: bigint[] = [];
  for (const id of ids) {
    const [capacityMiB, usedMiB, minPrice, open] = await pc.readContract({ address: SWARM, abi: swarmAbi, functionName: "offer", args: [id] });
    if (open && capacityMiB >= usedMiB + mib) prices.push(minPrice);
  }
  prices.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!prices.length) throw new Error("no Boltchain storage provider offers space right now");
  const cap = config.boltchain.maxPriceWei ? BigInt(config.boltchain.maxPriceWei) : null;
  const affordable = cap === null ? prices : prices.filter((p) => p <= cap);
  if (!affordable.length) throw new Error("every storage offer is above BOLT_MAX_PRICE_WEI");
  const replicas = Math.max(1, Math.min(affordable.length, config.boltchain.replicas));
  const price = affordable[replicas - 1];
  const e = epochs > MAX_DEAL_EPOCHS ? MAX_DEAL_EPOCHS : epochs < 1n ? 1n : epochs;
  return { replicas, price, epochs: e, cost: perEpoch(price, size) * BigInt(replicas) * e, offers: prices.length };
}

/** Hands blocks to our node (bolt_hostBlocks), which keeps announcing them until providers fetch them */
export async function hostBlocks(root: string, blocks: Block[]) {
  let batch: [string, string][] = [];
  let bytes = 0;
  for (let i = 0; i < blocks.length; i++) {
    batch.push([blocks[i].cid, toHex(blocks[i].bytes)]);
    bytes += blocks[i].bytes.length;
    if (bytes >= HOST_BATCH || i + 1 === blocks.length) {
      await rpc("bolt_hostBlocks", [root, batch]);
      batch = [];
      bytes = 0;
    }
  }
}

export async function getBlocks(cids: string[], deal?: bigint): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (let i = 0; i < cids.length; i += GET_BATCH) {
    const part = cids.slice(i, i + GET_BATCH);
    const got = await rpc<string[]>("bolt_getBlocks", deal === undefined ? [part] : [part, Number(deal)]);
    if (!Array.isArray(got) || got.length !== part.length) throw new Error("bolt_getBlocks returned the wrong number of blocks");
    got.forEach((h, j) => {
      const b = hexToBytes(h as Hex);
      checkBlock(part[j], b);
      out.push(b);
    });
  }
  return out;
}

export type DealResult = { dealId: bigint; root: string; blocks: number; size: bigint; replicas: number; endEpoch: bigint; paid: bigint; txHash: Hex };

/** Lists `blocks` in a deal index with entry point `entry`, hosts everything and pays the deal */
export async function createDeal(blocks: Block[], entry: string): Promise<DealResult> {
  const idx = buildDealIndex(blocks.map((b) => ({ cid: b.cid, size: b.bytes.length })), entry);
  await hostBlocks(idx.root, [...blocks, ...idx.indexBlocks]);
  const size = BigInt(idx.dealSize);
  const q = await quote(size);
  const wc = walletClient();
  const pc = publicClient();
  const args = [toHex(cidToBytes(idx.root)), BigInt(idx.count), size, q.replicas, q.epochs, q.price] as const;
  await pc.simulateContract({ account: wc.account, address: SWARM, abi: swarmAbi, functionName: "createDeal", args, value: q.cost });
  const txHash = await wc.writeContract({ address: SWARM, abi: swarmAbi, functionName: "createDeal", args, value: q.cost });
  const rc = await pc.waitForTransactionReceipt({ hash: txHash, timeout: 300_000 });
  if (rc.status !== "success") throw new Error(`createDeal reverted (${txHash})`);
  for (const log of rc.logs) {
    if (log.address.toLowerCase() !== SWARM) continue;
    try {
      const ev = decodeEventLog({ abi: swarmAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "DealCreated")
        return { dealId: ev.args.id, root: idx.root, blocks: idx.count, size, replicas: q.replicas, endEpoch: ev.args.endEpoch, paid: q.cost, txHash };
    } catch {
      /* other events */
    }
  }
  throw new Error(`no DealCreated event in ${txHash}`);
}

/** Seals `data` for a fresh key pair and stores it. Returns the deal and the secret key (wrap it!). */
export async function storeSealed(data: Uint8Array, name: string, mime: string) {
  const kp = vault.keyPair();
  const s = vault.seal(data, name, mime, kp.publicKey);
  const deal = await createDeal([...s.shards, s.manifest, s.envelope], s.envelope.cid);
  return { ...deal, envelope: s.envelope.cid, secretKey: kp.secretKey };
}

/** Reads and decrypts a sealed object back from Boltchain */
export async function readSealed(dealRoot: string, dealId: bigint, secretKey: Uint8Array): Promise<Uint8Array> {
  const [rootBlock] = await getBlocks([dealRoot], dealId);
  const idx = decodeDealIndex(rootBlock);
  if (!idx.root) throw new Error("the deal index names no file");
  const entry = idx.root.toString();
  const [envelope] = await getBlocks([entry], dealId);
  const { manifestCid, contentKey } = vault.openEnvelope(envelope, secretKey);
  const [mblock] = await getBlocks([manifestCid], dealId);
  const m = vault.openManifest(envelope, mblock, contentKey);
  const shards = await getBlocks(m.shards, dealId);
  return vault.recover(m, contentKey, shards);
}

export async function dealInfo(id: bigint) {
  const d = await publicClient().readContract({ address: SWARM, abi: swarmAbi, functionName: "deal", args: [id] });
  const [owner, root, blocks, size, replicas, startEpoch, endEpoch, price, perEpochWei, escrow, closed] = d;
  return { owner, root: root === "0x" ? null : cidFromBytes(hexToBytes(root)), blocks, size, replicas, startEpoch, endEpoch, price, perEpoch: perEpochWei, escrow, closed };
}

async function send(functionName: "extendDeal" | "cancelDeal" | "closeDeal" | "claim", args: readonly bigint[], value?: bigint) {
  const wc = walletClient();
  const pc = publicClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = { account: wc.account, address: SWARM, abi: swarmAbi, functionName, args, value } as any;
  await pc.simulateContract(req);
  const hash = await wc.writeContract(req);
  const rc = await pc.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (rc.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}

export async function extendDeal(id: bigint, epochs: bigint) {
  const d = await dealInfo(id);
  return send("extendDeal", [id, epochs], d.perEpoch * BigInt(d.replicas) * epochs);
}
export const cancelDeal = (id: bigint) => send("cancelDeal", [id]);
export const closeDeal = (id: bigint) => send("closeDeal", [id]);

/** Pays copies for finished epochs (anyone may) — keeps providers' income flowing */
export async function settleDeal(id: bigint) {
  const pc = publicClient();
  const now = await currentEpoch();
  const [, , paidThrough, open] = await pc.readContract({ address: SWARM, abi: swarmAbi, functionName: "dealSlots", args: [id] });
  let paid = 0;
  for (let k = 0; k < open.length; k++) {
    if (!open[k] || paidThrough[k] >= now) continue;
    try {
      await send("claim", [id, BigInt(k)]);
      paid++;
    } catch {
      /* a copy may have nothing to claim yet */
    }
  }
  return paid;
}
