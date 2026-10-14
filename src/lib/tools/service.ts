import { db } from "../db";
import { HttpError } from "../errors";
import { putObject } from "../storage";
import { compareVersions } from "../skills/spec";
import { notify } from "../notify";
import { requestAnchor } from "../boltchain/keeper";
import { hashFile, certUrl } from "../boltchain/certificates";
import { canonical, scanTool, toolHash, toolManifest, type ToolManifest } from "./spec";
import type { Tool, ToolVersion, User } from "@/generated/prisma/client";

export type Visibility = "PRIVATE" | "PUBLIC";

export const toolKey = (ownerId: string, name: string, version: string) => `tools/${ownerId}/${name}/${version}.json`;

export function toolJson(t: Tool & { owner: User; versions?: ToolVersion[] }, v?: ToolVersion | null, opts: { owner?: boolean } = {}) {
  return {
    id: `${t.owner.publisher ?? t.owner.account}/${t.name}`,
    name: t.name,
    kind: t.kind,
    title: (v?.manifest as ToolManifest | undefined)?.title ?? t.name,
    description: t.description,
    visibility: t.visibility,
    publisher: t.owner.publisher,
    latest: t.latestVersion,
    installs: t.installs,
    updated_at: t.updatedAt.toISOString(),
    ...(v
      ? {
          version: v.version,
          status: v.status,
          content_hash: v.contentHash,
          manifest: v.manifest,
          anchor: v.anchorCode ? { code: v.anchorCode, url: certUrl(v.anchorCode) } : null,
          ...(opts.owner ? { findings: v.scanFindings, review_note: v.reviewNote } : {}),
        }
      : {}),
  };
}

/** Register a new immutable tool version. Private: available at once. Public: after review. */
export async function publishTool(user: User, raw: unknown, visibility: Visibility) {
  const parsed = toolManifest.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid TOOL.json: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const m = parsed.data;
  const findings = scanTool(m, visibility);
  if (findings.some((f) => f.level === "error"))
    throw Object.assign(new HttpError(422, "rejected: " + findings.filter((f) => f.level === "error").map((f) => `${f.path} ${f.message}`).join("; ")), { findings });
  if (visibility === "PUBLIC" && !user.publisher) throw new HttpError(400, "set a publisher id in your account before publishing public tools");

  const existing = await db.tool.findUnique({ where: { ownerId_name: { ownerId: user.id, name: m.name } }, include: { versions: { select: { version: true } } } });
  if (existing?.versions.some((v) => v.version === m.version)) throw new HttpError(409, `version ${m.version} already exists — bump the version`);

  const body = Buffer.from(canonical(m));
  const key = toolKey(user.id, m.name, m.version);
  await putObject(key, body, "application/json");
  const status = visibility === "PUBLIC" ? "PENDING_REVIEW" : "APPROVED";
  // a private version never flips an already public tool back, and vice versa only through setVisibility
  const tool = await db.tool.upsert({
    where: { ownerId_name: { ownerId: user.id, name: m.name } },
    create: { ownerId: user.id, name: m.name, kind: m.kind, description: m.description, visibility },
    update: visibility === "PUBLIC" ? { description: m.description, visibility } : {},
  });
  const v = await db.toolVersion.create({
    data: { toolId: tool.id, version: m.version, contentHash: toolHash(m), manifest: m as object, objectKey: key, status, public: visibility === "PUBLIC", scanFindings: findings as object[] },
  });
  const latest = !tool.latestVersion || compareVersions(m.version, tool.latestVersion) > 0 ? m.version : tool.latestVersion;
  await db.tool.update({ where: { id: tool.id }, data: { latestVersion: latest } });
  // decision 3: the TOOL.json hash is notarized on Boltchain (Certificates) for third-party verification
  await requestAnchor("tool-version", v.id, [hashFile(body)]);
  return { id: `${user.publisher ?? user.account}/${m.name}`, version: m.version, status: status === "APPROVED" ? "active" : "pending_review", content_hash: v.contentHash, findings };
}

/** Who may see a tool: anyone for approved public versions, otherwise only its owner (and admins) */
export async function findTool(viewer: User | null, owner: string, name: string) {
  const ownerUser = await db.user.findFirst({ where: { OR: [{ publisher: owner }, { account: owner.toLowerCase() }] } });
  if (!ownerUser) throw new HttpError(404, "not found");
  const t = await db.tool.findUnique({ where: { ownerId_name: { ownerId: ownerUser.id, name } }, include: { owner: true, versions: { orderBy: { publishedAt: "desc" } } } });
  if (!t) throw new HttpError(404, "not found");
  const isOwner = viewer?.id === t.ownerId || !!viewer?.isAdmin;
  if (!isOwner && t.visibility !== "PUBLIC") throw new HttpError(404, "not found");
  // others only ever see reviewed versions that were published for everyone
  const versions = isOwner ? t.versions : t.versions.filter((v) => v.status === "APPROVED" && v.public);
  if (!versions.length) throw new HttpError(404, "not found");
  return { tool: t, versions, isOwner };
}

export async function setVisibility(user: User, name: string, visibility: Visibility) {
  const t = await db.tool.findUnique({ where: { ownerId_name: { ownerId: user.id, name } }, include: { versions: { orderBy: { publishedAt: "desc" }, take: 1 } } });
  if (!t) throw new HttpError(404, "not found");
  const latest = t.versions[0];
  if (visibility === "PUBLIC") {
    const m = latest.manifest as ToolManifest;
    const findings = scanTool(m, "PUBLIC");
    if (findings.some((f) => f.level === "error")) throw new HttpError(422, findings.filter((f) => f.level === "error").map((f) => `${f.path} ${f.message}`).join("; "));
    if (!user.publisher) throw new HttpError(400, "set a publisher id first");
    // going public needs review of the latest version
    if (!(latest.public && latest.status === "APPROVED")) await db.toolVersion.update({ where: { id: latest.id }, data: { status: "PENDING_REVIEW", public: true, scanFindings: findings as object[] } });
  }
  await db.tool.update({ where: { id: t.id }, data: { visibility } });
}

export async function reviewTool(admin: User, versionId: string, approve: boolean, note?: string) {
  if (!(await db.toolVersion.findUnique({ where: { id: versionId }, select: { id: true } }))) throw new HttpError(404, "version not found");
  const v = await db.toolVersion.update({
    where: { id: versionId },
    data: { status: approve ? "APPROVED" : "REJECTED", reviewNote: note ?? null, reviewerId: admin.id, reviewedAt: new Date() },
    include: { tool: true },
  });
  await notify(v.tool.ownerId, {
    type: approve ? "tool.approved" : "tool.rejected",
    title: approve ? `Tool ${v.tool.name}@${v.version} is public` : `Tool ${v.tool.name}@${v.version} was not approved`,
    body: note ?? "",
    link: "/account#tools",
  }).catch(() => undefined);
  return v;
}

export async function deleteTool(user: User, name: string) {
  const t = await db.tool.findUnique({ where: { ownerId_name: { ownerId: user.id, name } }, include: { versions: true } });
  if (!t) throw new HttpError(404, "not found");
  const { deleteObject } = await import("../storage");
  // private definitions are shredded at once; versions that were public stay stored 90 days (installs may reference them)
  for (const v of t.versions) if (v.objectKey) await deleteObject(v.objectKey, v.public ? { retainDays: 90 } : {});
  await db.tool.delete({ where: { id: t.id } });
}

/** 1–5 stars from a user who can see the tool (not its owner) */
export async function rateTool(user: User, toolId: string, stars: number) {
  const t = await db.tool.findUnique({ where: { id: toolId }, include: { versions: { where: { status: "APPROVED", public: true }, take: 1 } } });
  if (!t || t.visibility !== "PUBLIC" || !t.versions.length) throw new HttpError(404, "not found");
  if (t.ownerId === user.id) throw new HttpError(400, "you cannot rate your own tool");
  await db.toolRating.upsert({ where: { toolId_userId: { toolId, userId: user.id } }, create: { toolId, userId: user.id, stars }, update: { stars } });
  const agg = await db.toolRating.aggregate({ where: { toolId }, _avg: { stars: true }, _count: { stars: true } });
  return db.tool.update({ where: { id: toolId }, data: { ratingAvg: agg._avg.stars ?? 0, ratingCount: agg._count.stars } });
}

/** Admin takedown after a report: the tool leaves the directory; its public versions are revoked */
export async function takedownTool(toolId: string) {
  const t = await db.tool.update({ where: { id: toolId }, data: { visibility: "PRIVATE" } });
  await db.toolVersion.updateMany({ where: { toolId, public: true }, data: { status: "REVOKED" } });
  return t;
}
