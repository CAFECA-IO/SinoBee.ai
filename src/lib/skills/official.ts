/**
 * One rule for the 官方 / 已驗證 / 社群 tag, shared by the Skill Hub list, skill cards and the skill page,
 * so a skill never shows different tags in different places.
 */
export const OFFICIAL_PUBLISHER = "cafeca";

/** Skills bundled with SinoBee and published by the official publisher (prisma/seed-skills) */
export const OFFICIAL = ["ai-video-production", "memory-management", "database-analysis", "web-research", "browser-form-filling",
  "desktop-automation", "code-repo-explainer", "skill-authoring", "anatomy", "youtube-analysis", "engineering-feasibility",
  "dimensional-drawing", "dimensional-drawing-motion"] as const;
export type OfficialName = (typeof OFFICIAL)[number];

export const isOfficialSkill = (publisher: string | null | undefined, name: string) =>
  publisher === OFFICIAL_PUBLISHER && (OFFICIAL as readonly string[]).includes(name);

export type SkillTag = "official" | "verified" | "community";

/**
 * official  — bundled with SinoBee and published by CAFECA
 * verified  — verified publisher + the version is approved and signed by the Hub (SinoBee installs it as `verified`)
 * community — everything else
 */
export function skillTag(
  skill: { name: string; publisher: { publisher: string | null; publisherVerified: boolean } },
  version?: { status: string; signature: string | null } | null,
): SkillTag {
  if (isOfficialSkill(skill.publisher.publisher, skill.name)) return "official";
  if (skill.publisher.publisherVerified && version?.status === "APPROVED" && version.signature) return "verified";
  return "community";
}
