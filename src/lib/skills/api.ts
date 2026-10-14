import type { Skill, SkillTag, SkillVersion, User } from "@/generated/prisma/client";
import { bundleUrl } from "./service";
import { certUrl } from "../boltchain/certificates";

export const LISTED = { status: { in: ["PENDING_REVIEW", "APPROVED"] as ("PENDING_REVIEW" | "APPROVED")[] }, scanVerdict: { not: "DANGEROUS" as const } };

export function trustOf(publisher: User, v?: SkillVersion | null): "verified" | "community" {
  return publisher.publisherVerified && v?.status === "APPROVED" && v.signature ? "verified" : "community";
}

export function versionJson(publisher: string, name: string, v: SkillVersion) {
  const findings = (v.scanFindings as unknown[]) ?? [];
  return {
    version: v.version,
    sha256: v.contentHash,
    bundle_url: bundleUrl(publisher, name, v.version),
    signature: v.signature,
    reviewed: v.status === "APPROVED",
    published_at: v.publishedAt.toISOString(),
    size: v.bundleSize,
    scan: { verdict: v.scanVerdict.toLowerCase(), findings },
    // Boltchain certificate over the bundle and SKILL.md (null until notarized)
    anchor: v.anchorCode ? { code: v.anchorCode, url: certUrl(v.anchorCode) } : null,
  };
}

export function skillDetailJson(s: Skill & { publisher: User; versions: SkillVersion[]; tags: SkillTag[] }) {
  const pub = s.publisher.publisher!;
  return {
    id: `${pub}/${s.name}`,
    name: s.name,
    description: s.description,
    license: s.license,
    tags: s.tags.map((t) => t.tag),
    downloads: s.downloads,
    rating: { average: Math.round(s.ratingAvg * 100) / 100, count: s.ratingCount },
    publisher: { id: pub, verified: s.publisher.publisherVerified },
    url: `/skills/${pub}/${s.name}`,
    versions: s.versions.map((v) => versionJson(pub, s.name, v)),
  };
}
