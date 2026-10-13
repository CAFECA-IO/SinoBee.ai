import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config";

/**
 * Object storage for skill bundles and task results.
 * - local: files under STORAGE_LOCAL_DIR (development / single host)
 * - s3:    AWS S3 bucket (production); downloads use short-lived presigned URLs
 */
let s3: S3Client | null = null;
const client = () => (s3 ??= new S3Client({ region: config.storage.s3Region }));

const safeKey = (key: string) => {
  if (!/^[A-Za-z0-9._\/-]+$/.test(key) || key.includes("..")) throw new Error("invalid storage key");
  return key;
};

export async function putObject(key: string, body: Buffer, contentType = "application/octet-stream") {
  safeKey(key);
  if (config.storage.driver === "s3") {
    await client().send(new PutObjectCommand({ Bucket: config.storage.s3Bucket, Key: key, Body: body, ContentType: contentType }));
    return;
  }
  const f = path.resolve(config.storage.localDir, key);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, body);
}

export async function getObject(key: string): Promise<Buffer> {
  safeKey(key);
  if (config.storage.driver === "s3") {
    const r = await client().send(new GetObjectCommand({ Bucket: config.storage.s3Bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readFile(path.resolve(config.storage.localDir, key));
}

export async function deleteObject(key: string) {
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

/** S3: presigned URL (5 min). local: null → caller streams the bytes itself */
export async function downloadUrl(key: string, filename: string): Promise<string | null> {
  if (config.storage.driver !== "s3") return null;
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: config.storage.s3Bucket, Key: safeKey(key), ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"` }),
    { expiresIn: 300 },
  );
}
