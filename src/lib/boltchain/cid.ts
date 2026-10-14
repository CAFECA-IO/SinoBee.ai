import { createHash } from "node:crypto";

/**
 * IPLD pieces Boltchain uses, implemented directly (no ESM-only deps): CIDv1 with sha2-256,
 * codec raw (0x55) for data blocks and dag-cbor (0x71) for indexes; base32 multibase strings;
 * and the strict DAG-CBOR subset the deal index needs (unsigned ints, null, arrays, maps, CIDs).
 */
export const RAW = 0x55;
export const DAG_CBOR = 0x71;

export type Block = { cid: string; bytes: Uint8Array };

/** A CID value inside DAG-CBOR (encoded as tag 42) */
export class Cid {
  constructor(readonly bytes: Uint8Array) {}
  static parse(s: string) {
    return new Cid(cidToBytes(s));
  }
  toString() {
    return cidFromBytes(this.bytes);
  }
}

// ---------- varint / base32 ----------
function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}
function readVarint(b: Uint8Array, o: number): [number, number] {
  let n = 0, mul = 1;
  for (;;) {
    if (o >= b.length) throw new Error("truncated varint");
    const x = b[o++];
    n += (x & 0x7f) * mul;
    if (x < 0x80) return [n, o];
    mul *= 128;
  }
}
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(b: Uint8Array): string {
  let bits = 0, v = 0, out = "";
  for (const x of b) {
    v = (v << 8) | x;
    bits += 8;
    while (bits >= 5) {
      out += B32[(v >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(v << (5 - bits)) & 31];
  return out;
}
function unbase32(s: string): Uint8Array {
  const out: number[] = [];
  let bits = 0, v = 0;
  for (const ch of s) {
    const d = B32.indexOf(ch);
    if (d < 0) throw new Error("bad base32");
    v = ((v << 5) | d) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

// ---------- CIDs ----------
export function cidBytes(codec: number, data: Uint8Array): Uint8Array {
  const digest = createHash("sha256").update(data).digest();
  return Uint8Array.from([...varint(1), ...varint(codec), 0x12, 0x20, ...digest]);
}
export function cidFromBytes(b: Uint8Array): string {
  return "b" + base32(b);
}
export function cidToBytes(s: string): Uint8Array {
  if (!s.startsWith("b")) throw new Error(`unsupported CID encoding: ${s.slice(0, 12)}`);
  const b = unbase32(s.slice(1));
  parseCidBytes(b);
  return b;
}
export function parseCidBytes(b: Uint8Array) {
  let o = 0, version, codec, hash, len;
  [version, o] = readVarint(b, o);
  [codec, o] = readVarint(b, o);
  [hash, o] = readVarint(b, o);
  [len, o] = readVarint(b, o);
  if (version !== 1 || o + len !== b.length) throw new Error("malformed CID");
  return { codec, hash, digest: b.subarray(o) };
}
export const cidOf = (codec: number, data: Uint8Array) => cidFromBytes(cidBytes(codec, data));
export const rawCid = (data: Uint8Array) => cidOf(RAW, data);

/** Verifies a fetched block against its CID (sha2-256) */
export function checkBlock(cid: string, data: Uint8Array): void {
  const c = parseCidBytes(cidToBytes(cid));
  if (c.hash !== 0x12) throw new Error(`unsupported hash in ${cid}`);
  if (Buffer.compare(Buffer.from(c.digest), createHash("sha256").update(data).digest()) !== 0) throw new Error(`block ${cid} does not match its CID`);
}

// ---------- DAG-CBOR (subset) ----------
type Cbor = number | null | Cid | Cbor[] | { [k: string]: Cbor } | string;

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  if (n < 0x100000000) return [(major << 5) | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const hi = Math.floor(n / 0x100000000), lo = n >>> 0;
  return [(major << 5) | 27, (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff, (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff];
}
function enc(v: Cbor, out: number[]) {
  if (v === null) out.push(0xf6);
  else if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error("only unsigned integers are supported");
    out.push(...head(0, v));
  } else if (typeof v === "string") {
    const b = Buffer.from(v, "utf8");
    out.push(...head(3, b.length), ...b);
  } else if (v instanceof Cid) {
    const b = [0, ...v.bytes];
    out.push(0xd8, 42, ...head(2, b.length), ...b);
  } else if (Array.isArray(v)) {
    out.push(...head(4, v.length));
    for (const x of v) enc(x, out);
  } else {
    // canonical DAG-CBOR map key order: shorter keys first, then bytewise
    const keys = Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    out.push(...head(5, keys.length));
    for (const k of keys) {
      enc(k, out);
      enc(v[k], out);
    }
  }
}
export function encodeCbor(v: Cbor): Uint8Array {
  const out: number[] = [];
  enc(v, out);
  return Uint8Array.from(out);
}
export function decodeCbor<T = Cbor>(b: Uint8Array): T {
  let o = 0;
  const num = (info: number): number => {
    if (info < 24) return info;
    const n = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (n < 0 || o + n > b.length) throw new Error("bad cbor length");
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + b[o++];
    return v;
  };
  const dec = (): Cbor => {
    if (o >= b.length) throw new Error("truncated cbor");
    const x = b[o++], major = x >> 5, info = x & 31;
    if (x === 0xf6) return null;
    switch (major) {
      case 0: return num(info);
      case 2: { const n = num(info); const v = b.subarray(o, o + n); o += n; return v as unknown as Cbor; }
      case 3: { const n = num(info); const s = Buffer.from(b.subarray(o, o + n)).toString("utf8"); o += n; return s; }
      case 4: { const n = num(info); return Array.from({ length: n }, dec); }
      case 5: {
        const n = num(info);
        const m: { [k: string]: Cbor } = {};
        for (let i = 0; i < n; i++) {
          const k = dec();
          if (typeof k !== "string") throw new Error("map keys must be strings");
          m[k] = dec();
        }
        return m;
      }
      case 6: {
        if (num(info) !== 42) throw new Error("unsupported cbor tag");
        const v = dec() as unknown as Uint8Array;
        if (!(v instanceof Uint8Array) || v[0] !== 0) throw new Error("bad CID tag");
        return new Cid(Uint8Array.from(v.subarray(1)));
      }
      default: throw new Error("unsupported cbor item");
    }
  };
  const v = dec();
  if (o !== b.length) throw new Error("trailing cbor bytes");
  return v as T;
}
