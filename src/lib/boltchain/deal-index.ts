import { Cid, DAG_CBOR, cidOf, decodeCbor, encodeCbor, type Block } from "./cid";

/**
 * Deal index (Boltchain ADR 0014, bolt-ipld deal.rs): the blocks a SwarmStorage deal pays to keep,
 * in order, in dag-cbor groups of 1024 CIDs, under a root `{v:1, size, count, groups, root}`.
 * The root also names the entry point (a bolt-vault envelope or a certificate manifest).
 */
export const DEAL_GROUP = 1024;

export type DealIndex = { v: number; size: number; count: number; groups: Cid[]; root: Cid | null };

export function buildDealIndex(blocks: { cid: string; size: number }[], entry: string | null) {
  const out: Block[] = [];
  const groups: Cid[] = [];
  for (let i = 0; i < blocks.length; i += DEAL_GROUP) {
    const bytes = encodeCbor(blocks.slice(i, i + DEAL_GROUP).map((b) => Cid.parse(b.cid)));
    const cid = cidOf(DAG_CBOR, bytes);
    groups.push(Cid.parse(cid));
    out.push({ cid, bytes });
  }
  const size = blocks.reduce((a, b) => a + b.size, 0);
  const idx: DealIndex = { v: 1, size, count: blocks.length, groups, root: entry ? Cid.parse(entry) : null };
  const bytes = encodeCbor(idx);
  const root = cidOf(DAG_CBOR, bytes);
  out.push({ cid: root, bytes });
  /** what createDeal is told: listed blocks plus the index blocks */
  const dealSize = size + out.reduce((a, b) => a + b.bytes.length, 0);
  return { root, index: idx, indexBlocks: out, dealSize, count: blocks.length };
}

export function decodeDealIndex(bytes: Uint8Array): DealIndex {
  const i = decodeCbor<DealIndex>(bytes);
  if (i.v !== 1 || i.groups.length !== Math.ceil(i.count / DEAL_GROUP)) throw new Error("malformed deal index");
  return i;
}

export const decodeGroup = (bytes: Uint8Array) => decodeCbor<Cid[]>(bytes).map((c) => c.toString());
