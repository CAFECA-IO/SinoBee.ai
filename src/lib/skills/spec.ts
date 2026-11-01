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

/**
 * Compare versions by SemVer 2.0 precedence: major.minor.patch numerically, then a prerelease sorts before its
 * release, and two prereleases compare identifier by identifier (numbers numerically, numbers before words,
 * words in ASCII order, more identifiers wins when the rest are equal); build metadata (+…) is ignored.
 * Comparing prereleases matters for mirrored skills such as "1.4.1-main.7540eef.sinobee.2", whose x.y.z stays
 * at the upstream's while the SinoBee edition is revised: ignoring the prerelease made the seed skip the new one.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const noBuild = v.split("+")[0];
    const dash = noBuild.indexOf("-");
    const core = (dash < 0 ? noBuild : noBuild.slice(0, dash)).split(".").map(Number);
    return { core, pre: dash < 0 ? [] : noBuild.slice(dash + 1).split(".") };
  };
  const va = split(a), vb = split(b);
  for (let i = 0; i < 3; i++) {
    const x = va.core[i] || 0, y = vb.core[i] || 0;
    if (x !== y) return x - y;
  }
  if (!va.pre.length || !vb.pre.length) return va.pre.length === vb.pre.length ? 0 : va.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(va.pre.length, vb.pre.length); i++) {
    const x = va.pre[i], y = vb.pre[i];
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return va.pre.length - vb.pre.length;
}
