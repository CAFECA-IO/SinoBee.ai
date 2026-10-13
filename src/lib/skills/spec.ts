import YAML from "yaml";

/** Agent Skills spec (agentskills.io) as enforced by SinoBee — see SinoBee docs/SKILL_HUB.md §1 */
export const ALLOWED_FIELDS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"] as const;
export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
export const PUBLISHER_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;

export type Frontmatter = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  "allowed-tools"?: string;
  metadata?: Record<string, string>;
};

export type ParsedSkill = { frontmatter: Frontmatter; body: string };

export function parseSkillMd(text: string): ParsedSkill {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error("SKILL.md must start with YAML frontmatter (--- ... ---)");
  let fm: unknown;
  try {
    fm = YAML.parse(m[1]);
  } catch (e) {
    throw new Error("invalid YAML frontmatter: " + (e instanceof Error ? e.message : String(e)));
  }
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) throw new Error("frontmatter must be a mapping");
  return { frontmatter: fm as Frontmatter, body: m[2] };
}

/** Strict validation (what the Hub accepts). Returns a list of problems; empty = valid. */
export function validateFrontmatter(fm: Record<string, unknown>, dirName?: string): string[] {
  const errs: string[] = [];
  const extra = Object.keys(fm).filter((k) => !(ALLOWED_FIELDS as readonly string[]).includes(k));
  if (extra.length) errs.push(`unknown frontmatter fields: ${extra.join(", ")} (put extensions under metadata)`);
  const name = fm.name;
  if (typeof name !== "string" || !name) errs.push("name is required");
  else {
    if (name.length > 64) errs.push("name must be at most 64 characters");
    if (!NAME_RE.test(name)) errs.push("name must be lowercase letters/digits with single hyphens");
    if (dirName && dirName !== name) errs.push(`name "${name}" must equal the folder name "${dirName}"`);
  }
  const d = fm.description;
  if (typeof d !== "string" || !d.trim()) errs.push("description is required");
  else if (d.length > 1024) errs.push("description must be at most 1024 characters");
  if (fm.license !== undefined && typeof fm.license !== "string") errs.push("license must be a string");
  if (fm.compatibility !== undefined && (typeof fm.compatibility !== "string" || fm.compatibility.length > 500))
    errs.push("compatibility must be a string of at most 500 characters");
  if (fm["allowed-tools"] !== undefined && typeof fm["allowed-tools"] !== "string") errs.push("allowed-tools must be a space separated string");
  if (fm.metadata !== undefined) {
    if (!fm.metadata || typeof fm.metadata !== "object" || Array.isArray(fm.metadata)) errs.push("metadata must be a string-to-string mapping");
    else
      for (const [k, v] of Object.entries(fm.metadata as Record<string, unknown>))
        if (typeof v !== "string") errs.push(`metadata.${k} must be a string (quote it, e.g. "1.0.0")`);
  }
  const ver = (fm.metadata as Record<string, unknown> | undefined)?.version;
  if (typeof ver !== "string" || !VERSION_RE.test(ver)) errs.push('metadata.version is required for the Hub and must be semver, e.g. version: "1.0.0"');
  return errs;
}

export function tagsOf(fm: Frontmatter): string[] {
  return (fm.metadata?.["sinobee-tags"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[\p{L}\p{N}][\p{L}\p{N}-]{0,30}$/u.test(s))
    .slice(0, 12);
}

/** Compare semver-ish versions (numeric parts only, prerelease < release) */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  const ra = a.includes("-"), rb = b.includes("-");
  return ra === rb ? 0 : ra ? -1 : 1;
}
