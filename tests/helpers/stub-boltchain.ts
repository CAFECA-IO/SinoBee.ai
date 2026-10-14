/**
 * A protocol-faithful stand-in for a Boltchain node started with --rpc-storage, for tests:
 * JSON-RPC over HTTP with the eth_* calls viem needs, SwarmStorage (createDeal/extendDeal/cancelDeal/
 * closeDeal/claim/withdraw/offerList/offer/deal/dealSlots/balanceOf), Consensus.currentEpoch,
 * Certificates.issue/certificate, and bolt_hostBlocks / bolt_getBlocks with CID checks.
 * The pricing and checks follow SwarmStorage.sol / Certificates.sol.
 */
import http from "node:http";
import {
  decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, hexToBytes, keccak256, parseTransaction,
  parseAbi, recoverTransactionAddress, toHex, type Hex, type TransactionSerialized,
} from "viem";
import { CONSENSUS, SWARM, certificatesAbi, swarmAbi } from "../../src/lib/boltchain/chain";
import { checkBlock, cidFromBytes } from "../../src/lib/boltchain/cid";
import { codeOf, rootOf } from "../../src/lib/boltchain/certificates";

const consensusAbi = parseAbi(["function currentEpoch() view returns (uint64)"]);
const MiB = 1n << 20n;
const perEpoch = (price: bigint, size: bigint) => (price * ((size + MiB - 1n) / MiB) + 1023n) / 1024n;

type Deal = { owner: Hex; root: Hex; blocks: bigint; size: bigint; replicas: number; start: bigint; end: bigint; price: bigint; perEpoch: bigint; escrow: bigint; closed: boolean };
type Log = { address: Hex; topics: Hex[]; data: Hex };

export class StubBoltchain {
  chainId = 8018;
  epoch = 100n;
  height = 1n;
  offers: { id: number; capacityMiB: bigint; usedMiB: bigint; minPrice: bigint; open: boolean }[] = [
    { id: 1, capacityMiB: 1024n, usedMiB: 0n, minPrice: 10n ** 15n, open: true },
    { id: 2, capacityMiB: 1024n, usedMiB: 0n, minPrice: 2n * 10n ** 15n, open: true },
    { id: 3, capacityMiB: 1024n, usedMiB: 0n, minPrice: 3n * 10n ** 15n, open: true },
  ];
  deals: Deal[] = [];
  blocks = new Map<string, Uint8Array>();
  hosted = new Map<string, Set<string>>();
  balances = new Map<string, bigint>();
  nonces = new Map<string, number>();
  receipts = new Map<Hex, { status: "0x1" | "0x0"; logs: Log[]; blockNumber: bigint; from: Hex; to: Hex }>();
  certs = new Map<Hex, { issuer: Hex; root: Hex; deal: bigint; manifest: Hex; files: number; publicFiles: boolean; at: bigint }>();
  codeOfDeal = new Map<Hex, Hex>();
  calls: string[] = [];
  /** set to make the next n hostBlocks calls fail */
  failHost = 0;
  server?: http.Server;
  url = "";

  constructor(public certificates: Hex = "0xce00000000000000000000000000000000000016") {}

  async start(port = 0) {
    this.server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const one = async (m: { id: number; method: string; params: unknown[] }) => {
          try {
            // signature recovery is async, so raw transactions take their own path
            if (m.method === "eth_sendRawTransaction") return { jsonrpc: "2.0", id: m.id, result: await this.sendRaw(m.params[0] as TransactionSerialized) };
            return { jsonrpc: "2.0", id: m.id, result: this.handle(m.method, m.params ?? []) };
          } catch (e) {
            return { jsonrpc: "2.0", id: m.id, error: { code: (e as { code?: number }).code ?? 3, message: (e as Error).message, data: (e as { data?: Hex }).data } };
          }
        };
        const msg = JSON.parse(body);
        const out = Array.isArray(msg) ? await Promise.all(msg.map(one)) : await one(msg);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? toHex(v) : v)));
      });
    });
    await new Promise<void>((r) => this.server!.listen(port, "127.0.0.1", () => r()));
    const a = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${a.port}`;
    return this;
  }
  stop() {
    this.server?.close();
  }

  private revert(name: string): never {
    const sel = keccak256(new TextEncoder().encode(`${name}()`)).slice(0, 10) as Hex;
    const e = new Error(`execution reverted: ${name}`) as Error & { data: Hex };
    e.data = sel;
    throw e;
  }

  // ---------------- contract logic ----------------
  private exec(from: Hex, to: Hex, data: Hex, value: bigint, write: boolean): { ret: Hex; logs: Log[] } {
    to = to.toLowerCase() as Hex;
    const logs: Log[] = [];
    if (to === CONSENSUS.toLowerCase()) {
      return { ret: encodeFunctionResult({ abi: consensusAbi, functionName: "currentEpoch", result: this.epoch }), logs };
    }
    if (to === SWARM) {
      const { functionName, args } = decodeFunctionData({ abi: swarmAbi, data });
      const enc = (result: unknown) => encodeFunctionResult({ abi: swarmAbi, functionName, result } as never);
      switch (functionName) {
        case "offerList": return { ret: enc(this.offers.map((o) => o.id)), logs };
        case "offer": {
          const o = this.offers.find((x) => x.id === Number(args[0]));
          return { ret: enc(o ? [o.capacityMiB, o.usedMiB, o.minPrice, o.open, 0n] : [0n, 0n, 0n, false, 0n]), logs };
        }
        case "balanceOf": return { ret: enc(this.balances.get(String(args[0]).toLowerCase()) ?? 0n), logs };
        case "deal": {
          const d = this.deals[Number(args[0])];
          if (!d) return { ret: enc(["0x0000000000000000000000000000000000000000", "0x", 0n, 0n, 0, 0n, 0n, 0n, 0n, 0n, false]), logs };
          return { ret: enc([d.owner, d.root, d.blocks, d.size, d.replicas, d.start, d.end, d.price, d.perEpoch, d.escrow, d.closed]), logs };
        }
        case "dealSlots": {
          const d = this.deals[Number(args[0])];
          const n = d?.replicas ?? 0;
          return { ret: enc([Array.from({ length: n }, (_, i) => i + 1), Array(n).fill(d?.start ?? 0n), Array(n).fill(d?.start ?? 0n), Array(n).fill(true)]), logs };
        }
        case "createDeal": {
          const [root, blocks, size, replicas, epochs, price] = args as [Hex, bigint, bigint, number, bigint, bigint];
          return this.createDeal(from, root, blocks, size, replicas, epochs, price, value, write);
        }
        case "extendDeal": {
          const [id, epochs] = args as [bigint, bigint];
          const d = this.deals[Number(id)];
          if (!d || d.owner.toLowerCase() !== from.toLowerCase()) this.revert("NotOwner");
          if (d.closed || this.epoch >= d.end) this.revert("DealOver");
          if (epochs === 0n || d.end + epochs - d.start > 3650n) this.revert("BadDeal");
          if (value < d.perEpoch * BigInt(d.replicas) * epochs) this.revert("Underpaid");
          if (write) {
            d.end += epochs;
            d.escrow += value;
          }
          return { ret: "0x", logs };
        }
        case "cancelDeal": {
          const d = this.deals[Number(args[0])];
          if (!d || d.owner.toLowerCase() !== from.toLowerCase()) this.revert("NotOwner");
          if (d.closed || this.epoch >= d.end) this.revert("DealOver");
          if (write) d.end = this.epoch + 1n;
          return { ret: "0x", logs };
        }
        case "closeDeal": {
          const d = this.deals[Number(args[0])];
          if (!d || d.closed || this.epoch < d.end) this.revert("BadDeal");
          if (write) {
            const used = d.perEpoch * BigInt(d.replicas) * (d.end - d.start);
            const refund = d.escrow > used ? d.escrow - used : 0n;
            d.closed = true;
            const k = d.owner.toLowerCase();
            this.balances.set(k, (this.balances.get(k) ?? 0n) + refund);
          }
          return { ret: "0x", logs };
        }
        case "claim": return { ret: "0x", logs };
        case "withdraw": {
          if (write) this.balances.set(from.toLowerCase(), 0n);
          return { ret: "0x", logs };
        }
      }
    }
    if (to === this.certificates.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: certificatesAbi, data });
      const enc = (result: unknown) => encodeFunctionResult({ abi: certificatesAbi, functionName, result } as never);
      if (functionName === "issue") {
        const [salt, k, s, sizes, publicFiles, manifest, dealRoot, blocks, size, replicas, epochs, price] = args as [Hex, Hex[], Hex[], bigint[], boolean, Hex, Hex, bigint, bigint, number, bigint, bigint];
        if (k.length === 0 || k.length > 256 || s.length !== k.length || sizes.length !== k.length) this.revert("BadFiles");
        const root = rootOf(k.map((x, i) => ({ keccak256: x, sha256: s[i], size: Number(sizes[i]) })));
        const code = codeOf(root, from, salt);
        if (this.certs.has(code)) this.revert("CodeTaken");
        const dr = keccak256(dealRoot);
        if (this.codeOfDeal.has(dr)) this.revert("DealRootUsed");
        const dealRes = this.createDeal(this.certificates, dealRoot, blocks, size, replicas, epochs, price, value, write);
        const dealId = BigInt(this.deals.length - (write ? 1 : 0));
        if (write) {
          this.certs.set(code, { issuer: from, root, deal: dealId, manifest, files: k.length, publicFiles, at: this.height });
          this.codeOfDeal.set(dr, code);
          const ev = certificatesAbi.find((x) => x.type === "event" && x.name === "Issued")!;
          const topics = encodeEventTopics({ abi: [ev], eventName: "Issued", args: { code, issuer: from } } as never) as Hex[];
          const dataHex = encodeAbiParameters(
            [{ type: "bytes32" }, { type: "uint256" }, { type: "bool" }, { type: "bytes32[]" }, { type: "bytes32[]" }, { type: "uint64[]" }, { type: "bytes" }, { type: "bytes" }],
            [root, dealId, publicFiles, k, s, sizes, manifest, dealRoot],
          );
          logs.push(...dealRes.logs, { address: this.certificates, topics, data: dataHex });
        }
        return { ret: enc(code), logs };
      }
      if (functionName === "certificate") {
        const c = this.certs.get(args[0] as Hex);
        return { ret: enc(c ? { issuer: c.issuer, issuedAt: 0n, blockNumber: c.at, files: c.files, publicFiles: c.publicFiles, root: c.root, deal: c.deal, manifest: c.manifest } : { issuer: "0x0000000000000000000000000000000000000000", issuedAt: 0n, blockNumber: 0n, files: 0, publicFiles: false, root: `0x${"0".repeat(64)}`, deal: 0n, manifest: "0x" }), logs };
      }
    }
    throw new Error(`stub: no contract at ${to}`);
  }

  private createDeal(owner: Hex, root: Hex, blocks: bigint, size: bigint, replicas: number, epochs: bigint, price: bigint, value: bigint, write: boolean) {
    if (root === "0x" || blocks === 0n || size === 0n || replicas < 1 || replicas > 16 || epochs === 0n || epochs > 3650n || price === 0n) this.revert("BadDeal");
    const pe = perEpoch(price, size);
    if (value < pe * BigInt(replicas) * epochs) this.revert("Underpaid");
    const mib = (size + MiB - 1n) / MiB;
    const able = this.offers.filter((o) => o.open && o.minPrice <= price && o.capacityMiB >= o.usedMiB + mib);
    if (able.length < replicas) this.revert("NoProviders");
    // providers fetch the deal's blocks from the hosting node: every listed block must be hosted
    const rootCid = this.cidString(root);
    if (!this.hosted.has(rootCid)) this.revert("NoProviders");
    const id = BigInt(this.deals.length);
    const logs: Log[] = [];
    if (write) {
      this.deals.push({ owner, root, blocks, size, replicas, start: this.epoch, end: this.epoch + epochs, price, perEpoch: pe, escrow: value, closed: false });
      for (const o of able.slice(0, replicas)) o.usedMiB += mib;
      const ev = swarmAbi.find((x) => x.type === "event" && x.name === "DealCreated")!;
      const topics = encodeEventTopics({ abi: [ev], eventName: "DealCreated", args: { id, owner } } as never) as Hex[];
      const data = encodeAbiParameters(
        [{ type: "bytes" }, { type: "uint64" }, { type: "uint64" }, { type: "uint8" }, { type: "uint64" }, { type: "uint64" }, { type: "uint128" }],
        [root, blocks, size, replicas, this.epoch, this.epoch + epochs, price],
      );
      logs.push({ address: SWARM, topics, data });
    }
    return { ret: encodeAbiParameters([{ type: "uint256" }], [id]), logs };
  }

  private cidString(b: Hex) {
    return cidFromBytes(hexToBytes(b));
  }

  // ---------------- JSON-RPC ----------------
  handle(method: string, p: unknown[]): unknown {
    this.calls.push(method);
    switch (method) {
      case "eth_chainId": return toHex(this.chainId);
      case "net_version": return String(this.chainId);
      case "eth_blockNumber": return toHex(this.height);
      case "eth_gasPrice": return toHex(10n ** 9n);
      case "eth_maxPriorityFeePerGas": return toHex(10n ** 9n);
      case "eth_getBalance": return toHex(10n ** 24n);
      case "eth_estimateGas": {
        const t = p[0] as { from: Hex; to: Hex; data: Hex; value?: Hex };
        this.exec(t.from, t.to, t.data, BigInt(t.value ?? 0), false);
        return toHex(500_000);
      }
      case "eth_getTransactionCount": return toHex(this.nonces.get(String(p[0]).toLowerCase()) ?? 0);
      case "eth_getBlockByNumber":
        return { number: toHex(this.height), hash: keccak256(toHex(this.height)), parentHash: `0x${"0".repeat(64)}`, timestamp: toHex(Math.floor(Date.now() / 1000)), baseFeePerGas: toHex(10n ** 9n), gasLimit: toHex(30_000_000), gasUsed: "0x0", transactions: [], miner: `0x${"0".repeat(40)}`, difficulty: "0x0", extraData: "0x", logsBloom: `0x${"0".repeat(512)}`, nonce: "0x0000000000000000", sha3Uncles: `0x${"0".repeat(64)}`, size: "0x0", stateRoot: `0x${"0".repeat(64)}`, receiptsRoot: `0x${"0".repeat(64)}`, transactionsRoot: `0x${"0".repeat(64)}`, uncles: [], mixHash: `0x${"0".repeat(64)}`, totalDifficulty: "0x0" };
      case "eth_call": {
        const t = p[0] as { from?: Hex; to: Hex; data: Hex; value?: Hex };
        return this.exec(t.from ?? `0x${"0".repeat(40)}`, t.to, t.data, BigInt(t.value ?? 0), false).ret;
      }
      case "eth_getTransactionReceipt": {
        const r = this.receipts.get(p[0] as Hex);
        if (!r) return null;
        return {
          transactionHash: p[0], transactionIndex: "0x0", blockHash: keccak256(toHex(r.blockNumber)), blockNumber: toHex(r.blockNumber), from: r.from, to: r.to,
          cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: toHex(10n ** 9n), contractAddress: null, type: "0x2", status: r.status, logsBloom: `0x${"0".repeat(512)}`,
          logs: r.logs.map((l, i) => ({ ...l, logIndex: toHex(i), transactionHash: p[0], transactionIndex: "0x0", blockHash: keccak256(toHex(r.blockNumber)), blockNumber: toHex(r.blockNumber), removed: false })),
        };
      }
      case "eth_getTransactionByHash": return null;
      case "bolt_hostBlocks": {
        if (this.failHost > 0) {
          this.failHost--;
          throw new Error("storage RPC disabled");
        }
        const [root, list] = p as [string, [string, Hex][]];
        const set = this.hosted.get(root) ?? new Set<string>();
        for (const [cid, hex] of list) {
          const b = hexToBytes(hex);
          checkBlock(cid, b);
          this.blocks.set(cid, b);
          set.add(cid);
        }
        this.hosted.set(root, set);
        return null;
      }
      case "bolt_getBlocks": {
        const [cids] = p as [string[]];
        if (cids.length > 256) throw new Error("at most 256 blocks");
        return cids.map((c) => {
          const b = this.blocks.get(c);
          if (!b) throw new Error(`block ${c} not found`);
          return toHex(b);
        });
      }
    }
    throw Object.assign(new Error(`the method ${method} does not exist/is not available`), { code: -32601 });
  }

  async sendRaw(raw: TransactionSerialized) {
    const tx = parseTransaction(raw);
    const from = (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() as Hex;
    const hash = keccak256(raw);
    this.nonces.set(from, (this.nonces.get(from) ?? 0) + 1);
    this.height++;
    try {
      const r = this.exec(from, tx.to!, tx.data ?? "0x", tx.value ?? 0n, true);
      this.receipts.set(hash, { status: "0x1", logs: r.logs, blockNumber: this.height, from, to: tx.to! });
    } catch {
      this.receipts.set(hash, { status: "0x0", logs: [], blockNumber: this.height, from, to: tx.to! });
    }
    return hash;
  }
}

