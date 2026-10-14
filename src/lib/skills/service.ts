import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { putObject } from "@/lib/storage";
import { requestAnchor } from "@/lib/boltchain/keeper";
import { hashFile } from "@/lib/boltchain/certificates";
import { config } from "@/lib/config";
import { notify } from "@/lib/notify";
import { BundleError, buildBundle, contentHash, fileManifest, readUpload } from "./bundle";
import { compareVersions, parseSkillMd, tagsOf, validateFrontmatter } from "./spec";
import { scanSkill } from "./scan";
import { signContentHash } from "./signing";
import type { User } from "@/generated/prisma/client";

export const bundleUrl = (publisher: string, name: string, version: string) =>
  `${config.origin}/api/v1/bundles/${publisher}/${name}/${version}.tar.gz`;

export type PublishResult = { id: string; version: string; status: "pending_review" | "rejected"; content_hash: string; findings: unknown[] };

/** Validate, scan, hash, bundle and store a new immutable skill version. */
export async function publishSkill(user: User, data: Buffer, filename: string): Promise<PublishResult> {
  if (!user.publisher) throw new HttpError(400, "set a publisher id in your account before publishing");
  let up;
  try {
    up = await readUpload(data, filename);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
  const md = up.files.get("SKILL.md");
  if (!md) throw new HttpError(400, "SKILL.md missing");
  let parsed;
  try {
    parsed = parseSkillMd(md.toString("utf8"));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
  const fm = parsed.frontmatter;
  const errs = validateFrontmatter(fm as unknown as Record<string, unknown>, up.dirName || undefined);
  if (errs.length) throw new HttpError(400, "invalid skill: " + errs.join("; "));
  const version = fm.metadata!.version;
  const hash = contentHash(up.files);

  if (await db.revocation.findUnique({ where: { contentHash: hash } })) throw new HttpError(400, "this content has been revoked by the Hub");

  const existing = await db.skill.findUnique({
    where: { publisherId_name: { publisherId: user.id, name: fm.name } },
    include: { versions: { select: { version: true } } },
  });
  if (existing?.versions.some((v) => v.version === version))
    throw new HttpError(409, `version ${version} already exists — published versions are immutable, bump metadata.version`);

  const scan = scanSkill(up.files);
  const manifest = {
    spec: "agentskills.io",
    name: fm.name,
    version,
    description: fm.description,
    license: fm.license ?? null,
    content_hash: hash,
    files: fileManifest(up.files),
    exported_at: new Date().toISOString(),
    client: "sinobee.ai-hub",
  };
  const bundle = await buildBundle(fm.name, up.files, manifest);
  const key = `skills/${user.publisher}/${fm.name}/${version}.tar.gz`;
  await putObject(key, bundle, "application/gzip");

  const tags = tagsOf(fm);
  const skill = existing
    ? await db.skill.update({
        where: { id: existing.id },
        data: {
          description: fm.description,
          license: fm.license ?? null,
          tags: { deleteMany: {}, create: tags.map((tag) => ({ tag })) },
          latestVersion: !existing.latestVersion || compareVersions(version, existing.latestVersion) > 0 ? version : existing.latestVersion,
        },
      })
    : await db.skill.create({
        data: { publisherId: user.id, name: fm.name, description: fm.description, license: fm.license ?? null, tags: { create: tags.map((tag) => ({ tag })) }, latestVersion: version },
      });

  const rejected = scan.verdict === "DANGEROUS";
  const sv = await db.skillVersion.create({
    data: {
      skillId: skill.id,
      version,
      contentHash: hash,
      bundleKey: key,
      bundleSize: bundle.length,
      manifest,
      skillMd: md.toString("utf8"),
      files: Object.fromEntries([...up.files].map(([p, b]) => [p, b.length])),
      status: rejected ? "REJECTED" : "PENDING_REVIEW",
      scanVerdict: scan.verdict,
      scanFindings: scan.findings,
      reviewNote: rejected ? "automatic scan marked this version dangerous" : null,
    },
  });
  // the bundle and its SKILL.md are notarized on Boltchain (Certificates) for third-party verification
  if (!rejected) await requestAnchor("skill-version", sv.id, [hashFile(bundle), hashFile(md)]);
  return { id: `${user.publisher}/${fm.name}`, version: sv.version, status: rejected ? "rejected" : "pending_review", content_hash: hash, findings: scan.findings };
}

export async function reviewVersion(reviewer: User, versionId: string, decision: "approve" | "reject" | "revoke", note?: string) {
  const v = await db.skillVersion.findUnique({ where: { id: versionId }, include: { skill: { include: { publisher: true } } } });
  if (!v) throw new HttpError(404, "version not found");
  if (decision === "approve") {
    if (v.scanVerdict === "DANGEROUS") throw new HttpError(400, "cannot approve a version the scanner marked dangerous");
    const signature = signContentHash(v.contentHash);
    if (!signature) throw new HttpError(500, "HUB_SIGNING_KEY is not configured");
    await db.skillVersion.update({ where: { id: v.id }, data: { status: "APPROVED", signature, reviewerId: reviewer.id, reviewedAt: new Date(), reviewNote: note ?? null } });
  } else if (decision === "reject") {
    await db.skillVersion.update({ where: { id: v.id }, data: { status: "REJECTED", reviewerId: reviewer.id, reviewedAt: new Date(), reviewNote: note ?? null } });
  } else {
    await db.$transaction([
      db.revocation.upsert({ where: { contentHash: v.contentHash }, create: { contentHash: v.contentHash, reason: note ?? "revoked" }, update: {} }),
      db.skillVersion.update({ where: { id: v.id }, data: { status: "REVOKED", reviewerId: reviewer.id, reviewedAt: new Date(), reviewNote: note ?? null } }),
    ]);
  }
  await notify(v.skill.publisherId, {
    type: `skill.${decision}`,
    title: `${v.skill.name}@${v.version}: ${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revoked"}`,
    body: note ?? "",
    link: `/skills/${v.skill.publisher.publisher}/${v.skill.name}`,
  });
}

export async function rateSkill(userId: string, skillId: string, stars: number) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, "stars must be 1-5");
  await db.skillRating.upsert({ where: { skillId_userId: { skillId, userId } }, create: { skillId, userId, stars }, update: { stars } });
  const agg = await db.skillRating.aggregate({ where: { skillId }, _avg: { stars: true }, _count: true });
  await db.skill.update({ where: { id: skillId }, data: { ratingAvg: agg._avg.stars ?? 0, ratingCount: agg._count } });
}

export { BundleError };
