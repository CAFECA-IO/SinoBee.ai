import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { keccak256 } from "viem";
import { config } from "./config";
import { db } from "./db";

/**
 * Object storage for skill bundles, task results, tool manifests, vault packs and shares.
 *
 * Mirror (fast path):
 * - local: files under STORAGE_LOCAL_DIR (development / single host)
 * - s3:    AWS S3 bucket (production); downloads use short-lived presigned URLs
 *
 * Boltchain (system of record, when configured — see config.boltchain): every put also records a
 * StorageObject; the storage keeper seals it with bolt-vault and pays a SwarmStorage deal right away.
 * Reads fall back to Boltchain when the mirror copy is gone; deletes destroy the object's key
 * (crypto-shred) and cancel the deal.
 */
let s3: S3Client | null = null;
const client = () => (s3 ??= new S3Client({ region: config.storage.s3Region }));

const safeKey = (key: string) => {
  if (!/^[A-Za-z0-9._\/-]+$/.test(key) || key.includes("..")) throw new Error("invalid storage key");
  return key;
};

async function mirrorPut(key: string, body: Buffer, contentType = "application/octet-stream") {
  safeKey(key);
  if (config.storage.driver === "s3") {
    await client().send(new PutObjectCommand({ Bucket: config.storage.s3Bucket, Key: key, Body: body, ContentType: contentType }));
    return;
  }
  const f = path.resolve(config.storage.localDir, key);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, body);
}

export async function mirrorGet(key: string): Promise<Buffer> {
  safeKey(key);
  if (config.storage.driver === "s3") {
    const r = await client().send(new GetObjectCommand({ Bucket: config.storage.s3Bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readFile(path.resolve(config.storage.localDir, key));
}

export async function mirrorDelete(key: string) {
  safeKey(key);
  if (config.storage.driver === "s3") {
    await client().send(new DeleteObjectCommand({ Bucket: config.storage.s3Bucket, Key: key }));
    return;
  }
  await rm(path.resolve(config.storage.localDir, key), { force: true });
}

export async function objectSize(key: string): Promise<number> {
  if (config.storage.driver === "s3") return 0;
  return (await stat(path.resolve(config.storage.localDir, key))).size;
}

/** S3: presigned URL (5 min). local, or only on Boltchain: null → caller streams the bytes itself */
export async function downloadUrl(key: string, filename: string): Promise<string | null> {
  if (config.storage.driver !== "s3") return null;
  if (config.boltchain.enabled) {
    const o = await db.storageObject.findUnique({ where: { key }, select: { mirrored: true } });
    if (o && !o.mirrored) return null;
  }
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: config.storage.s3Bucket, Key: safeKey(key), ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"` }),
    { expiresIn: 300 },
  );
}

const kindOf = (key: string) => key.split("/")[0] || "object";

export async function putObject(key: string, body: Buffer, contentType = "application/octet-stream") {
  safeKey(key);
  await mirrorPut(key, body, contentType);
  if (!config.boltchain.enabled) return;
  const data = {
    kind: kindOf(key),
    size: BigInt(body.length),
    sha256: createHash("sha256").update(body).digest("hex"),
    keccak: keccak256(body),
    contentType,
    status: "PENDING" as const,
    mirrored: true,
    error: null,
    attempts: 0,
    nextTryAt: new Date(),
    deletedAt: null,
  };
  const prev = await db.storageObject.findUnique({ where: { key } });
  // an overwritten object gets a new deal; the old one is cancelled by the keeper
  if (prev?.dealId && prev.status === "STORED" && prev.sha256 !== data.sha256) await queueCancel(prev.dealId);
  if (prev?.sha256 === data.sha256 && prev.status === "STORED") {
    await db.storageObject.update({ where: { key }, data: { mirrored: true } });
    return;
  }
  await db.storageObject.upsert({
    where: { key },
    create: { key, ...data },
    update: { ...data, envelopeCid: null, dealRoot: null, dealId: null, blocks: null, dealSize: null, replicas: null, endEpoch: null, paidWei: null, txHash: null, recipientKey: null },
  });
}

/** cancelled deals are tracked as tombstone rows so the keeper can cancel and later close them */
async function queueCancel(dealId: bigint) {
  await db.storageObject.create({
    data: { key: `_cancel/${dealId}`, kind: "_cancel", size: 0n, sha256: "", keccak: "", status: "DELETED", dealId, dealState: "active", deletedAt: new Date(), mirrored: false },
  }).catch(() => undefined);
}

export async function getObject(key: string): Promise<Buffer> {
  safeKey(key);
  try {
    return await mirrorGet(key);
  } catch (e) {
    if (!config.boltchain.enabled) throw e;
    const o = await db.storageObject.findUnique({ where: { key } });
    if (!o || o.status !== "STORED" || !o.dealRoot || o.dealId == null || !o.recipientKey) throw e;
    const { readSealed } = await import("./boltchain/swarm");
    const { unwrapKey } = await import("./boltchain/keys");
    const bytes = Buffer.from(await readSealed(o.dealRoot, o.dealId, unwrapKey(o.recipientKey, key)));
    if (createHash("sha256").update(bytes).digest("hex") !== o.sha256) throw new Error(`object ${key} from Boltchain does not match its hash`);
    return bytes;
  }
}

export async function deleteObject(key: string) {
  safeKey(key);
  await mirrorDelete(key);
  if (!config.boltchain.enabled) return;
  // crypto-shred: without recipientKey the sealed copies on Boltchain can never be opened again
  await db.storageObject.updateMany({
    where: { key, status: { not: "DELETED" } },
    data: { status: "DELETED", recipientKey: null, deletedAt: new Date(), mirrored: false, nextTryAt: new Date(), attempts: 0 },
  });
}
