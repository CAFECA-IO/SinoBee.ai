import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./errors";
import { deleteObject, getObject, putObject } from "./storage";

/**
 * End-to-end encrypted vault. The server only ever holds:
 *  - the user's vault public key (X25519) and its private key wrapped with a passphrase-derived key
 *    (scrypt → AES-256-GCM), done on the user's machine;
 *  - packs: opaque ciphertext sealed to the public key (ephemeral X25519 + HKDF-SHA256 + AES-256-GCM).
 * Packs live in Boltchain-backed storage like everything else; the bytes are already ciphertext.
 */
const b64 = z.string().regex(/^[A-Za-z0-9+/=_-]+$/).max(4096);

export const wrappedKeySchema = z
  .object({
    v: z.literal(1),
    kdf: z.object({ alg: z.literal("scrypt"), n: z.number().int().min(16384).max(1 << 20), r: z.number().int().min(8).max(32), p: z.number().int().min(1).max(16), salt: b64 }).strict(),
    iv: b64,
    ct: b64,
  })
  .strict();

export const vaultKeyBody = z.object({ publicKey: b64, wrapped: wrappedKeySchema, replace: z.boolean().optional() }).strict();

export const PACK_MAX = 1 << 20;
export const PACK_NAME = /^[a-z0-9:_-]{1,80}$/;
const packKey = (userId: string, name: string) => `vault/${userId}/${name.replace(/:/g, "_")}`;

export async function getVaultKey(userId: string) {
  return db.vaultKey.findUnique({ where: { userId } });
}

export async function setVaultKey(userId: string, body: z.infer<typeof vaultKeyBody>) {
  if (Buffer.from(body.publicKey, "base64").length !== 32) throw new HttpError(400, "publicKey must be 32 bytes (X25519)");
  const prev = await getVaultKey(userId);
  if (prev && prev.publicKey !== body.publicKey && !body.replace)
    throw new HttpError(409, "a different vault key exists — send replace: true to start over (existing packs are deleted)");
  if (prev && prev.publicKey !== body.publicKey) {
    for (const p of await db.vaultPack.findMany({ where: { userId } })) await deleteObject(p.objectKey);
    await db.vaultPack.deleteMany({ where: { userId } });
    await db.vaultDeviceKey.deleteMany({ where: { userId } });
  }
  // same public key → only the wrapping changed (new passphrase)
  return db.vaultKey.upsert({ where: { userId }, create: { userId, publicKey: body.publicKey, wrapped: body.wrapped }, update: { publicKey: body.publicKey, wrapped: body.wrapped } });
}

export async function listPacks(userId: string) {
  return db.vaultPack.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { name: true, size: true, sha256: true, revision: true, updatedAt: true } });
}

export async function readPack(userId: string, name: string) {
  const p = await db.vaultPack.findUnique({ where: { userId_name: { userId, name } } });
  if (!p) throw new HttpError(404, "not found");
  return { name, revision: p.revision, sha256: p.sha256, data: (await getObject(p.objectKey)).toString("utf8"), updatedAt: p.updatedAt };
}

/** Optimistic concurrency: `revision` is the one the client last read (omit to create) */
export async function writePack(userId: string, name: string, data: string, revision?: number) {
  if (!PACK_NAME.test(name)) throw new HttpError(400, "bad pack name");
  if (!(await getVaultKey(userId))) throw new HttpError(409, "set up the vault key first");
  const bytes = Buffer.from(data, "utf8");
  if (bytes.length > PACK_MAX) throw new HttpError(413, "pack too large (1 MiB)");
  // the server cannot check the crypto, but it can refuse things that are obviously not a sealed pack
  let env: { v?: number; epk?: string; iv?: string; ct?: string };
  try {
    env = JSON.parse(data);
  } catch {
    throw new HttpError(400, "pack must be a sealed JSON envelope");
  }
  if (env.v !== 1 || !env.epk || !env.iv || !env.ct) throw new HttpError(400, "pack must be a sealed envelope {v:1, epk, iv, ct}");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const prev = await db.vaultPack.findUnique({ where: { userId_name: { userId, name } } });
  if (prev && revision !== undefined && prev.revision !== revision) throw new HttpError(409, `stale revision (server has ${prev.revision})`);
  if (!prev && revision !== undefined && revision !== 0) throw new HttpError(409, "pack does not exist");
  const objectKey = packKey(userId, name);
  await putObject(objectKey, bytes, "application/json");
  return prev
    ? db.vaultPack.update({ where: { id: prev.id }, data: { size: bytes.length, sha256, revision: { increment: 1 }, objectKey } })
    : db.vaultPack.create({ data: { userId, name, objectKey, size: bytes.length, sha256 } });
}

export async function deletePack(userId: string, name: string) {
  const p = await db.vaultPack.findUnique({ where: { userId_name: { userId, name } } });
  if (!p) return false;
  await deleteObject(p.objectKey);
  await db.vaultPack.delete({ where: { id: p.id } });
  return true;
}

// ---------- device keys: the vault private key sealed to each signed-in SinoBee ----------

const envelope = z.object({ v: z.literal(1), epk: b64, iv: b64, ct: b64 }).strict();

export async function vaultDevices(userId: string, currentDeviceId?: string | null) {
  const devices = await db.device.findMany({ where: { userId, revokedAt: null }, include: { vaultKey: { select: { createdAt: true } } }, orderBy: { lastSeenAt: "desc" } });
  return devices.map((d) => ({
    id: d.id, name: d.name, platform: d.platform, publicKey: d.publicKey, hasKey: !!d.vaultKey, current: d.id === currentDeviceId,
    lastSeenAt: d.lastSeenAt.toISOString(),
  }));
}

/** Store the vault key sealed to `deviceId` (sent by a device that has the vault unlocked) */
export async function setDeviceKey(userId: string, deviceId: string, wrapped: string) {
  let env: unknown;
  try {
    env = JSON.parse(wrapped);
  } catch {
    throw new HttpError(400, "wrapped must be a sealed envelope");
  }
  if (!envelope.safeParse(env).success) throw new HttpError(400, "wrapped must be a sealed envelope {v:1, epk, iv, ct}");
  const d = await db.device.findFirst({ where: { id: deviceId, userId, revokedAt: null } });
  if (!d) throw new HttpError(404, "device not found");
  if (!d.publicKey) throw new HttpError(409, "this device has no key — sign in again from that SinoBee");
  if (!(await getVaultKey(userId))) throw new HttpError(409, "set up the vault key first");
  return db.vaultDeviceKey.upsert({ where: { deviceId }, create: { deviceId, userId, wrapped }, update: { wrapped } });
}

export async function deleteDeviceKey(userId: string, deviceId: string) {
  return (await db.vaultDeviceKey.deleteMany({ where: { deviceId, userId } })).count > 0;
}

export async function deviceWrapped(deviceId: string | null | undefined) {
  if (!deviceId) return null;
  return (await db.vaultDeviceKey.findUnique({ where: { deviceId } }))?.wrapped ?? null;
}
