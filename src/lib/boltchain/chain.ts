import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";

/** Boltchain (EVM, chain id 8018) clients for the site wallet that pays storage and certificates. */
export const SWARM = "0xb017000000000000000000000000000000000005" as const;
export const CONSENSUS = "0xB017000000000000000000000000000000000002" as const;

export const swarmAbi = parseAbi([
  "function createDeal(bytes root, uint64 blocks, uint64 size, uint8 replicas, uint64 epochs, uint128 price) payable returns (uint256 id)",
  "function extendDeal(uint256 id, uint64 epochs) payable",
  "function cancelDeal(uint256 id)",
  "function closeDeal(uint256 id)",
  "function claim(uint256 id, uint256 slot)",
  "function withdraw(address to)",
  "function balanceOf(address) view returns (uint256)",
  "function offerList() view returns (uint32[])",
  "function offer(uint32 id) view returns (uint64 capacityMiB, uint64 usedMiB, uint128 minPrice, bool open, uint256 committed)",
  "function deal(uint256 id) view returns (address owner, bytes root, uint64 blocks, uint64 size, uint8 replicas, uint64 startEpoch, uint64 endEpoch, uint128 price, uint128 perEpoch, uint256 escrow, bool closed)",
  "function dealSlots(uint256 id) view returns (uint32[] providers, uint64[] since, uint64[] paidThrough, bool[] open)",
  "event DealCreated(uint256 indexed id, address indexed owner, bytes root, uint64 blocks, uint64 size, uint8 replicas, uint64 startEpoch, uint64 endEpoch, uint128 price)",
  "error NotOwner()",
  "error BadDeal()",
  "error NoProviders()",
  "error Underpaid()",
  "error DealOver()",
  "error NotLive()",
]);

export const certificatesAbi = parseAbi([
  "function issue(bytes32 salt, bytes32[] k, bytes32[] s, uint64[] sizes, bool publicFiles, bytes manifest, bytes dealRoot, uint64 blocks, uint64 size, uint8 replicas, uint64 epochs, uint128 price) payable returns (bytes10 code)",
  "function codeOf(bytes32 root, address issuer, bytes32 salt) pure returns (bytes10)",
  "function rootOf(bytes32[] k, bytes32[] s, uint64[] sizes) pure returns (bytes32)",
  "function codeOfDeal(bytes32) view returns (bytes10)",
  "function certificate(bytes10 code) view returns ((address issuer, uint64 issuedAt, uint64 blockNumber, uint32 files, bool publicFiles, bytes32 root, uint256 deal, bytes manifest))",
  "event Issued(bytes10 indexed code, address indexed issuer, bytes32 root, uint256 deal, bool publicFiles, bytes32[] keccak, bytes32[] sha, uint64[] sizes, bytes manifest, bytes dealRoot)",
  "error BadFiles()",
  "error CodeTaken()",
  "error DealRootUsed()",
]);

const consensusAbi = parseAbi(["function currentEpoch() view returns (uint64)"]);

export const boltchain = () =>
  defineChain({
    id: config.boltchain.chainId,
    name: "Boltchain",
    nativeCurrency: { name: "BOLT", symbol: "BOLT", decimals: 18 },
    rpcUrls: { default: { http: [config.boltchain.rpcUrl] } },
  });

let pub: ReturnType<typeof createPublicClient> | null = null;
export function publicClient() {
  return (pub ??= createPublicClient({ chain: boltchain(), transport: http(config.boltchain.rpcUrl, { timeout: 30_000 }) }));
}

export function siteAccount() {
  const k = config.boltchain.walletKey;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("BOLT_WALLET_KEY is not set (0x + 64 hex)");
  return privateKeyToAccount(k as Hex);
}

export function walletClient() {
  return createWalletClient({ account: siteAccount(), chain: boltchain(), transport: http(config.boltchain.rpcUrl, { timeout: 60_000 }) });
}

export async function currentEpoch(): Promise<bigint> {
  return publicClient().readContract({ address: CONSENSUS, abi: consensusAbi, functionName: "currentEpoch" });
}

let rpcId = 0;
/** Raw JSON-RPC (bolt_* storage methods need a node started with --rpc-storage) */
export async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(config.boltchain.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}

export const enabled = () => config.boltchain.enabled;

/**
 * Gas for a Boltchain call: the node's estimate plus headroom. Storage deals and certificates pick providers and
 * touch state that changes between the estimate and the block (gas used varied by ~7% on the testnet), so a bare
 * estimate can run out of gas and revert. Unused gas is refunded.
 */
export function withHeadroom(estimate: bigint): bigint {
  return (estimate * 135n) / 100n + 25_000n;
}

/** The node's newest block may be at most this old before the site stops signing (blocks come every ~6 s) */
export const MAX_HEAD_AGE_S = 180;
/** Site-wallet transactions allowed to wait in the node's pool before the site stops sending more (the pool takes 16) */
export const MAX_IN_FLIGHT = 4;

const ago = (s: number) => (s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172_800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);

/**
 * Checks that the site's node follows the chain and that nothing the site sent is stuck, before anything is signed.
 * A node that stopped (for example one too old for a hard fork: it rejects the fork block and stays behind) still
 * admits transactions to its pool, so every send would wait for a receipt that never comes, and after 16 of them
 * the pool refuses the next nonce ("nonce too high") — the errors would hide the real problem.
 * Returns null when ready, otherwise the reason.
 */
export async function nodeProblem(): Promise<string | null> {
  const pc = publicClient();
  const head = await pc.getBlock({ blockTag: "latest" });
  const age = Math.floor(Date.now() / 1000) - Number(head.timestamp);
  if (age > MAX_HEAD_AGE_S)
    return `Boltchain node is not following the chain: its newest block #${head.number} is ${ago(age)} old. Upgrade the node (BOLTCHAIN_REF; a node too old for a hard fork stops at the fork block) or restart it.`;
  const address = siteAccount().address;
  const [mined, pending] = await Promise.all([pc.getTransactionCount({ address, blockTag: "latest" }), pc.getTransactionCount({ address, blockTag: "pending" })]);
  if (pending - mined >= MAX_IN_FLIGHT)
    return `${pending - mined} site-wallet transactions (nonce ${mined}–${pending - 1}) are waiting in the node's pool and are not being mined; nothing more is sent until they are (restarting the node clears its pool).`;
  return null;
}

export async function assertNodeReady() {
  const p = await nodeProblem();
  if (p) throw new NodeNotReady(p);
}

export class NodeNotReady extends Error {
  readonly notReady = true;
}

/** Simulates, sends with gas headroom and waits; throws `<label> reverted …` (and says when it ran out of gas) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendContract(req: any, label: string) {
  await assertNodeReady();
  const wc = walletClient();
  const pc = publicClient();
  const full = { account: wc.account, ...req };
  await pc.simulateContract(full);
  const gas = withHeadroom(await pc.estimateContractGas(full));
  const hash = await wc.writeContract({ ...full, gas });
  const rc = await pc.waitForTransactionReceipt({ hash, timeout: 300_000 }).catch(async (e) => {
    // say why it was not mined when the node is the reason
    const p = await nodeProblem().catch(() => null);
    throw p ? new NodeNotReady(`${label} ${hash} was not mined in 5 min. ${p}`) : e;
  });
  if (rc.status !== "success") throw new Error(`${label} reverted (${hash}${rc.gasUsed >= gas ? `, out of gas at ${gas}` : ""})`);
  return { hash, receipt: rc };
}
