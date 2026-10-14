/* tslint:disable */
/* eslint-disable */

/**
 * A new envelope that also lets `public_key` read the file (after a job is matched).
 */
export function addRecipient(envelope: Uint8Array, content_key: Uint8Array, public_key: Uint8Array): object;

/**
 * CID (CIDv1, raw, sha2-256) of a block.
 */
export function cidOf(bytes: Uint8Array): string;

/**
 * A new X25519 key pair: `{ secretKey, publicKey }` (32 bytes each).
 */
export function generateKeyPair(): object;

/**
 * Opens an envelope with a recipient's secret key: `{ manifestCid, contentKey }`.
 */
export function openEnvelope(envelope: Uint8Array, secret_key: Uint8Array): object;

/**
 * Decrypts the manifest: `{ name, mime, size, chunk, chunks, k, m, shards: [cid, ...] }`.
 */
export function openManifest(envelope: Uint8Array, manifest: Uint8Array, content_key: Uint8Array): any;

/**
 * Public key of a secret key.
 */
export function publicKeyOf(secret_key: Uint8Array): Uint8Array;

/**
 * Reassembles the file. `shards` has one entry per manifest shard: `Uint8Array`, or `null` when
 * it could not be fetched. `manifest_json` is the `json` field returned by `openManifest`.
 */
export function recover(manifest_json: string, content_key: Uint8Array, shards: Array<any>): Uint8Array;

/**
 * Seals a file for `recipients` (array of 32-byte public keys). Returns
 * `{ envelope, manifest, shards: [...], contentKey }`; store every block, share the envelope CID.
 */
export function seal(data: Uint8Array, name: string, mime: string, recipients: Array<any>, k?: number | null, m?: number | null): object;
