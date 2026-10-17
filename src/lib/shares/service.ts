import { randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { HttpError } from "../errors";
import { deleteObject, getObject, putObject } from "../storage";
import { requestAnchor } from "../boltchain/keeper";
import { hashFile } from "../boltchain/certificates";
import type { User } from "@/generated/prisma/client";

/**
 * Conversation shares. SinoBee redacts secrets and shows a preview before upload; the server checks
 * size and shape again, stores the share JSON and files (Boltchain-backed), and notarizes their
 * hashes (decision 3). Visibility:
 *   LINK   — anyone with the link (not listed)
 *   LOGIN  — signed-in CAFECA users; with `accounts`, only those accounts (decision 2)
 *   PUBLIC — anyone, listed on /shares
 * Revoking deletes the objects: their keys are destroyed (crypto-shred) and the deals cancelled.
 */
/** the conversation itself (JSON) */
export const MAX_SHARE_BYTES = 5 * 1024 * 1024;
/** attachments: 25 MB each, 100 MB per share (plan: 對話分享) */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 40;
export const DEFAULT_DAYS = 30;

const tool = z.object({ name: z.string().max(80), input: z.string().max(4000).optional(), output: z.string().max(8000).optional() });
const message = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(200_000),
  tools: z.array(tool).max(100).optional(),
  at: z.string().max(40).optional(),
});
const file = z.object({ name: z.string().min(1).max(200), mime: z.string().max(100).default("application/octet-stream"), data: z.string().max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8) });

export const shareBody = z.object({
  /** chat: a conversation; doc: a report or interactive page a skill made, `entry` names its main file */
  kind: z.enum(["chat", "doc"]).default("chat"),
  entry: z.string().max(300).nullish(),
  title: z.string().trim().min(1).max(160),
  /** link-preview summary (Open Graph / X cards) */
  description: z.string().trim().max(300).nullish(),
  /** bundle paths of the multipart files, in order (some multipart parsers drop folders from file names) */
  fileNames: z.array(z.string().max(300)).max(MAX_FILES).default([]),
  visibility: z.enum(["LINK", "LOGIN", "PUBLIC"]).default("LINK"),
  /** LOGIN only: CAFECA accounts (0x addresses) or @handles allowed to view; empty = any signed-in user */
  accounts: z.array(z.string().trim().max(64)).max(100).default([]),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  model: z.string().max(120).nullish(),
  messages: z.array(message).max(2000),
  files: z.array(file).max(MAX_FILES).default([]),
  /** skills SinoBee used in the conversation (names) */
  skills: z.array(z.string().max(80)).max(50).default([]),
  /** what SinoBee redacted, for the viewer banner (counts only) */
  redactions: z.array(z.object({ kind: z.string().max(40), count: z.number().int().min(0) })).max(20).default([]),
});

export type ShareDoc = {
  v: 1;
  kind?: "chat" | "doc";
  entry?: string | null;
  description?: string | null;
  title: string;
  model: string | null;
  created_at: string;
  messages: z.infer<typeof message>[];
  files: { id: string; name: string; mime: string; size: number }[];
  redactions: { kind: string; count: number }[];
  skills?: string[];
};

export type UploadFile = { name: string; mime: string; bytes: Buffer };

/** A bundle path (doc1/frames/t0915.jpg): folders kept, every part made safe, never .. or absolute */
export function safePath(name: string): string {
  const parts = name.replace(/\\/g, "/").split("/").map((x) => x.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim()).filter((x) => x && x !== "." && x !== "..");
  return parts.map((x) => x.replace(/^\.+/, "_").slice(0, 120)).join("/").slice(0, 300) || "file";
}

/** Bundle files that only open inside the sandboxed document frame (/api/shares/<id>/raw/…) */
export const DOC_MIME = /^(text\/(html|css|javascript|plain|csv|markdown)|application\/(javascript|json|wasm|xhtml\+xml)|image\/svg\+xml|font\/(woff2?|ttf|otf)|model\/gltf(\+json|-binary))$/;
const EXT_MIME: Record<string, string> = {
  md: "text/markdown", markdown: "text/markdown", html: "text/html", htm: "text/html", xhtml: "application/xhtml+xml", svg: "image/svg+xml",
  css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json", txt: "text/plain", csv: "text/csv",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", wasm: "application/wasm",
  glb: "model/gltf-binary", gltf: "model/gltf+json", pdf: "application/pdf",
};
export const mimeOf = (name: string, given = "") => EXT_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? given;

/** The link-preview picture: PNG / JPEG / WebP, at most 2 MB */
export const MAX_THUMB_BYTES = 2 * 1024 * 1024;
export function thumbMime(b: Buffer): string | null {
  if (b.length > MAX_THUMB_BYTES || b.length < 16) return null;
  if (b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

const ALPHA = "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const newId = () => Array.from({ length: 12 }, () => ALPHA[randomInt(ALPHA.length)]).join("");
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SAFE_MIME = /^(image\/(png|jpe?g|gif|webp)|video\/(mp4|webm|quicktime|ogg)|audio\/(mpeg|mp4|ogg|wav|webm)|text\/(plain|csv|markdown)|application\/(json|pdf|zip|gzip))$/;

// formats the server refuses even after SinoBee's redaction (a second line of defence)
const SECRET_RX: [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["API key", /\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|xox[abprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20}|sbh_[A-Za-z0-9_-]{30,})\b/],
  ["connection string with a password", /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]+:(?!••••@)[^\s@/]{3,}@/i],
];

/** Refuse conversations that still contain obvious secrets */
export function scanSecrets(text: string): string | null {
  for (const [what, rx] of SECRET_RX) if (rx.test(text)) return what;
  return null;
}

/** @handles and addresses → lowercase addresses; unknown handles are an error (so a typo never widens access) */
export async function resolveAccounts(list: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const raw of list) {
    const a = raw.trim();
    if (!a) continue;
    if (ADDRESS.test(a)) {
      out.add(a.toLowerCase());
      continue;
    }
    const handle = a.replace(/^@/, "").toLowerCase();
    const u = await db.user.findFirst({ where: { OR: [{ handle }, { publisher: handle }] } });
    if (!u) throw new HttpError(400, `unknown CAFECA account: ${a}`);
    out.add(u.account);
  }
  return [...out];
}

export async function createShare(owner: User, input: unknown, uploads: UploadFile[] = [], thumb: Buffer | null = null) {
  const b = shareBody.parse(input);
  if (b.kind === "chat" && !b.messages.length) throw new HttpError(400, "messages: a conversation share needs at least one message");
  const all = [...b.files.map((f) => ({ name: f.name, mime: f.mime, bytes: Buffer.from(f.data, "base64") })), ...uploads];
  if (all.length > MAX_FILES) throw new HttpError(413, `at most ${MAX_FILES} attachments`);
  const files = all.map((f, i) => {
    // documents keep their folder layout so relative links between their files still work
    const name = safePath(b.fileNames[i] ?? f.name);
    const mime = mimeOf(name, f.mime.split(";")[0].trim());
    // page types only as part of a document (they open in the sandboxed frame); a loose attachment stays a download
    const doc = b.kind === "doc" || name.includes("/");
    return { id: String(i + 1), name, mime: SAFE_MIME.test(mime) || (doc && DOC_MIME.test(mime)) ? mime : "application/octet-stream", bytes: f.bytes };
  });
  const entry = b.kind === "doc" ? safePath(b.entry ?? files[0]?.name ?? "") : null;
  if (b.kind === "doc" && !files.some((f) => f.name === entry)) throw new HttpError(400, "entry: the document's main file is not among the files");
  const og = thumb ? thumbMime(thumb) : null;
  if (thumb && !og) throw new HttpError(400, "thumb: a PNG, JPEG or WebP picture of at most 2 MB");
  for (const f of files) if (f.bytes.length > MAX_FILE_BYTES) throw new HttpError(413, `${f.name} is larger than 25 MB`);
  // documents are scanned too: their text files are what viewers read
  const docText = b.kind === "doc" ? files.filter((f) => DOC_MIME.test(f.mime) || f.mime === "text/markdown").map((f) => f.bytes.toString("utf8")).join("\n") : "";
  const leak = scanSecrets(JSON.stringify(b.messages) + "\n" + b.title + "\n" + (b.description ?? "") + "\n" + docText);
  if (leak) throw new HttpError(422, `the conversation still contains a ${leak} — redact it in SinoBee and try again`);
  const id = newId();
  const doc: ShareDoc = {
    v: 1,
    kind: b.kind,
    entry,
    description: b.description ?? null,
    title: b.title,
    model: b.model ?? null,
    created_at: new Date().toISOString(),
    messages: b.messages,
    files: files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.bytes.length })),
    redactions: b.redactions,
    skills: b.skills,
  };
  const body = Buffer.from(JSON.stringify(doc));
  if (body.length > MAX_SHARE_BYTES) throw new HttpError(413, `conversation too large (${Math.round(body.length / 1024)} KiB > ${MAX_SHARE_BYTES >> 20} MiB)`);
  const total = files.reduce((a, f) => a + f.bytes.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new HttpError(413, `attachments too large (${Math.round(total / 1048576)} MB > 100 MB)`);
  const days = b.expiresInDays === undefined ? DEFAULT_DAYS : b.expiresInDays;
  const expiresAt = days ? new Date(Date.now() + days * 86400_000) : null;
  const accounts = b.visibility === "LOGIN" ? await resolveAccounts(b.accounts) : [];
  if (b.visibility !== "LOGIN" && b.accounts.length) throw new HttpError(400, "accounts only apply to LOGIN shares");

  const objectKey = `shares/${id}/share.json`;
  // stored on Boltchain (2 copies) only until the share expires
  await putObject(objectKey, body, "application/json", { keepUntil: expiresAt });
  for (const f of files) await putObject(`shares/${id}/files/${f.id}`, f.bytes, f.mime, { keepUntil: expiresAt });
  const ogKey = thumb && og ? `shares/${id}/og` : null;
  if (ogKey) await putObject(ogKey, thumb!, og!, { keepUntil: expiresAt });
  const share = await db.conversationShare.create({
    data: {
      id,
      ownerId: owner.id,
      title: b.title,
      visibility: b.visibility,
      restricted: accounts.length > 0,
      objectKey,
      contentHash: `sha256:${hashFile(body).sha256.slice(2)}`,
      messages: b.messages.length,
      model: b.model ?? null,
      kind: b.kind,
      entry,
      description: b.description ?? null,
      ogKey,
      expiresAt,
      access: { create: accounts.map((account) => ({ account })) },
      files: { create: files.map((f) => ({ name: f.name, objectKey: `shares/${id}/files/${f.id}`, size: f.bytes.length, sha256: hashFile(f.bytes).sha256.slice(2), mime: f.mime })) },
    },
  });
  // decision 3: share.json and every file are notarized on Boltchain
  await requestAnchor("share", id, [hashFile(body), ...files.map((f) => hashFile(f.bytes)), ...(ogKey ? [hashFile(thumb!)] : [])]);
  return share;
}

export type Access = { ok: true } | { ok: false; status: 401 | 403 | 404 | 410; reason: string };

/** Who may read a share — the single place this is decided (page, files, API) */
export async function canView(share: { ownerId: string; visibility: string; restricted: boolean; revokedAt: Date | null; expiresAt: Date | null; id: string }, viewer: User | null): Promise<Access> {
  if (share.revokedAt) return { ok: false, status: 410, reason: "revoked" };
  if (share.expiresAt && share.expiresAt < new Date()) return { ok: false, status: 410, reason: "expired" };
  if (viewer && (viewer.id === share.ownerId || viewer.isAdmin)) return { ok: true };
  if (share.visibility === "LINK" || share.visibility === "PUBLIC") return { ok: true };
  if (!viewer) return { ok: false, status: 401, reason: "login" };
  if (!share.restricted) return { ok: true };
  const allowed = await db.shareAccess.findUnique({ where: { shareId_account: { shareId: share.id, account: viewer.account.toLowerCase() } } });
  return allowed ? { ok: true } : { ok: false, status: 403, reason: "not_allowed" };
}

export async function loadShare(id: string, viewer: User | null) {
  if (!/^[A-Za-z0-9]{6,20}$/.test(id)) return { share: null, access: { ok: false, status: 404, reason: "not_found" } as Access };
  const share = await db.conversationShare.findUnique({ where: { id }, include: { owner: true, files: true } });
  if (!share) return { share: null, access: { ok: false, status: 404, reason: "not_found" } as Access };
  return { share, access: await canView(share, viewer) };
}

export async function readDoc(objectKey: string): Promise<ShareDoc> {
  return JSON.parse((await getObject(objectKey)).toString("utf8")) as ShareDoc;
}

export async function revokeShare(id: string, by: User, reason = "owner") {
  const s = await db.conversationShare.findUnique({ where: { id }, include: { files: true } });
  if (!s || (s.ownerId !== by.id && !by.isAdmin)) throw new HttpError(404, "not found");
  if (s.revokedAt) return s;
  // crypto-shred: deleting the objects destroys their keys and cancels the Boltchain deals
  await deleteObject(s.objectKey);
  for (const f of s.files) await deleteObject(f.objectKey);
  if (s.ogKey) await deleteObject(s.ogKey);
  const r = await db.conversationShare.update({ where: { id }, data: { revokedAt: new Date() } });
  if (reason !== "owner") await db.report.updateMany({ where: { targetType: "share", targetId: id, resolvedAt: null }, data: { resolvedAt: new Date() } });
  return r;
}

export const shareUpdate = z.object({
  visibility: z.enum(["LINK", "LOGIN", "PUBLIC"]).optional(),
  accounts: z.array(z.string().trim().max(64)).max(100).optional(),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(300).nullable().optional(),
});

export async function updateShare(id: string, owner: User, input: unknown) {
  const b = shareUpdate.parse(input);
  const s = await db.conversationShare.findUnique({ where: { id } });
  if (!s || s.ownerId !== owner.id || s.revokedAt) throw new HttpError(404, "not found");
  const visibility = b.visibility ?? s.visibility;
  if (b.expiresInDays !== undefined) {
    const { setKeepUntil } = await import("../storage");
    await setKeepUntil(`shares/${id}/`, b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 86400_000) : null);
  }
  const accounts = visibility === "LOGIN" && b.accounts ? await resolveAccounts(b.accounts) : null;
  await db.$transaction([
    ...(visibility !== "LOGIN" || accounts ? [db.shareAccess.deleteMany({ where: { shareId: id } })] : []),
    ...(accounts?.length ? [db.shareAccess.createMany({ data: accounts.map((account) => ({ shareId: id, account })) })] : []),
    db.conversationShare.update({
      where: { id },
      data: {
        visibility,
        ...(b.title ? { title: b.title } : {}),
        ...(b.description !== undefined ? { description: b.description || null } : {}),
        ...(visibility !== "LOGIN" ? { restricted: false } : accounts ? { restricted: accounts.length > 0 } : {}),
        ...(b.expiresInDays !== undefined ? { expiresAt: b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 86400_000) : null } : {}),
      },
    }),
  ]);
}

/** Anyone may see the link preview (title, description, picture): LINK and PUBLIC shares that are still live */
export function previewable(s: { visibility: string; revokedAt: Date | null; expiresAt: Date | null }) {
  return (s.visibility === "LINK" || s.visibility === "PUBLIC") && !s.revokedAt && !(s.expiresAt && s.expiresAt < new Date());
}

export function shareJson(s: { id: string; title: string; visibility: string; restricted: boolean; messages: number; views: number; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null; anchorCode: string | null; contentHash: string; kind?: string; description?: string | null; ogKey?: string | null }, origin: string) {
  return {
    id: s.id, url: `${origin}/s/${s.id}`, title: s.title, kind: s.kind ?? "chat", description: s.description ?? null,
    thumbnail: s.ogKey ? `${origin}/api/shares/${s.id}/og` : null,
    visibility: s.visibility, restricted: s.restricted, messages: s.messages, views: s.views,
    content_hash: s.contentHash, anchor: s.anchorCode, created_at: s.createdAt.toISOString(), expires_at: s.expiresAt?.toISOString() ?? null, revoked: !!s.revokedAt,
  };
}
