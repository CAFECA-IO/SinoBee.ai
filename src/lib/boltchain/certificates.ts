import { createHash, randomBytes } from "node:crypto";
import { decodeEventLog, encodeAbiParameters, keccak256, toHex, type Hex } from "viem";
import { config } from "../config";
import { cidToBytes, rawCid, type Block } from "./cid";
import { buildDealIndex } from "./deal-index";
import { certificatesAbi, sendContract, walletClient } from "./chain";
import { hostBlocks, quote } from "./swarm";

/**
 * Evidence certificates (Boltchain ADR 0016): content hashes notarized on chain under a short code
 * anyone can check at <explorer>/cert/<code>. Only hashes and sizes are recorded (never names).
 */
export type FileHash = { keccak256: Hex; sha256: Hex; size: number };

export function hashFile(data: Uint8Array): FileHash {
  return { keccak256: keccak256(data), sha256: `0x${createHash("sha256").update(data).digest("hex")}`, size: data.length };
}

// prefixed-abi-v1 Merkle tree (ADR 0015): leaf = keccak(abi(0x00, keccak(abi(k, s, size)))), node = keccak(abi(0x01, l, r)), lone node carried up
export function leafOf(f: FileHash): Hex {
  const inner = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }], [f.keccak256, f.sha256, BigInt(f.size)]));
  return keccak256(encodeAbiParameters([{ type: "bytes1" }, { type: "bytes32" }], ["0x00", inner]));
}

export function rootOf(files: FileHash[]): Hex {
  if (files.length === 0 || files.length > 256) throw new Error("a certificate holds 1 to 256 files");
  let layer = files.map(leafOf);
  while (layer.length > 1) {
    const next: Hex[] = [];
    for (let a = 0; a < layer.length; a += 2)
      next.push(a + 1 < layer.length ? keccak256(encodeAbiParameters([{ type: "bytes1" }, { type: "bytes32" }, { type: "bytes32" }], ["0x01", layer[a], layer[a + 1]])) : layer[a]);
    layer = next;
  }
  return layer[0];
}

/** bytes10(keccak256(abi.encode(root, issuer, salt))) */
export const codeOf = (root: Hex, issuer: Hex, salt: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }], [root, issuer, salt])).slice(0, 22) as Hex;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 10 bytes → 16 Crockford base-32 characters, shown as XXXX-XXXX-XXXX-XXXX */
export function encodeCode(hex: Hex): string {
  let v = BigInt(hex);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out = CROCKFORD[Number(v & 31n)] + out;
    v >>= 5n;
  }
  return out;
}
export const formatCode = (c: string) => c.match(/.{4}/g)!.join("-");
export function decodeCode(s: string): Hex | null {
  let v = 0n, n = 0;
  for (const ch of s.toUpperCase()) {
    if (ch === "-" || ch === " ") continue;
    const c = ch === "I" || ch === "L" ? "1" : ch === "O" ? "0" : ch;
    const d = CROCKFORD.indexOf(c);
    if (d < 0) return null;
    v = (v << 5n) | BigInt(d);
    n++;
  }
  return n === 16 ? (`0x${v.toString(16).padStart(20, "0")}` as Hex) : null;
}

/** The explorer's canonical JSON: sorted keys */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Manifest kept in the certificate's storage deal (hashes and sizes, no names) — same bytes as verify.js certManifest */
export function certManifest(files: FileHash[], salt: Hex): Uint8Array {
  return new TextEncoder().encode(canonicalJson({ v: 1, type: "boltchain-certificate", salt, files: files.map((f) => ({ keccak256: f.keccak256, sha256: f.sha256, size: f.size })) }));
}

export const newSalt = () => toHex(randomBytes(32));
export const certUrl = (code: string) => `${config.boltchain.explorer}/cert/${formatCode(code)}`;

export type Issued = { code: string; codeHex: Hex; root: Hex; txHash: Hex; dealId: bigint };

/** Issues an evidence-only certificate paid by the site wallet (publicFiles = false) */
export async function issue(files: FileHash[], salt: Hex): Promise<Issued> {
  const address = config.boltchain.certificates as Hex;
  if (!address) throw new Error("BOLT_CERTIFICATES is not set");
  const wc = walletClient();
  const manifest: Block = (() => {
    const bytes = certManifest(files, salt);
    return { cid: rawCid(bytes), bytes };
  })();
  const idx = buildDealIndex([{ cid: manifest.cid, size: manifest.bytes.length }], manifest.cid);
  await hostBlocks(idx.root, [manifest, ...idx.indexBlocks]);
  // evidence only: billed as 1 MiB
  const size = BigInt(idx.dealSize);
  const q = await quote(size);
  const root = rootOf(files);
  const codeHex = codeOf(root, wc.account.address, salt);
  const args = [
    salt, files.map((f) => f.keccak256), files.map((f) => f.sha256), files.map((f) => BigInt(f.size)), false,
    toHex(cidToBytes(manifest.cid)), toHex(cidToBytes(idx.root)), BigInt(idx.count), size, q.replicas, q.epochs, q.price,
  ] as const;
  const { hash: txHash, receipt: rc } = await sendContract({ address, abi: certificatesAbi, functionName: "issue", args, value: q.cost }, "issue");
  for (const log of rc.logs) {
    if (log.address.toLowerCase() !== address) continue;
    try {
      const ev = decodeEventLog({ abi: certificatesAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Issued") return { code: encodeCode(ev.args.code), codeHex: ev.args.code, root: ev.args.root, txHash, dealId: ev.args.deal };
    } catch {
      /* SwarmStorage events */
    }
  }
  return { code: encodeCode(codeHex), codeHex, root, txHash, dealId: 0n };
}
