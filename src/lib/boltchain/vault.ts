import { createRequire } from "node:module";
import path from "node:path";
import type * as BoltVault from "bolt-vault";
import type { Block } from "./cid";

/**
 * bolt-vault (WASM) — the same sealing format `boltchain storage put` uses.
 * Loaded at run time from node_modules (it reads its .wasm next to itself), never bundled.
 */
let mod: typeof BoltVault | null = null;
function load(): typeof BoltVault {
  if (mod) return mod;
  const name = ["bolt", "vault"].join("-");
  const req = createRequire(path.join(/*turbopackIgnore: true*/ process.cwd(), "package.json"));
  return (mod = req(name) as typeof BoltVault);
}
const bv = new Proxy({} as typeof BoltVault, { get: (_t, k) => (load() as unknown as Record<string | symbol, unknown>)[k] });
type RawBlock = { cid: string; bytes: Uint8Array };

export function keyPair(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  return bv.generateKeyPair() as { secretKey: Uint8Array; publicKey: Uint8Array };
}

export function seal(data: Uint8Array, name: string, mime: string, recipient: Uint8Array) {
  const s = bv.seal(data, name, mime, [recipient]) as { envelope: RawBlock; manifest: RawBlock; shards: RawBlock[]; contentKey: Uint8Array };
  return { envelope: s.envelope as Block, manifest: s.manifest as Block, shards: s.shards as Block[] };
}

export type Manifest = { name: string; mime: string; size: number; shards: string[]; json: string };

export function openEnvelope(envelope: Uint8Array, secretKey: Uint8Array) {
  return bv.openEnvelope(envelope, secretKey) as { manifestCid: string; contentKey: Uint8Array };
}

export function openManifest(envelope: Uint8Array, manifest: Uint8Array, contentKey: Uint8Array): Manifest {
  return bv.openManifest(envelope, manifest, contentKey) as Manifest;
}

export function recover(m: Manifest, contentKey: Uint8Array, shards: (Uint8Array | null)[]): Uint8Array {
  return bv.recover(m.json, contentKey, shards);
}
