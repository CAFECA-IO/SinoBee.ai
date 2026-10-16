import type { SkillTag } from "@/lib/skills/official";

const STYLE: Record<SkillTag, string> = {
  official: "bg-accent-soft text-accent",
  verified: "bg-accent-soft text-ok",
  community: "bg-panel-2 text-muted",
};

/** the 官方 / 已驗證 / 社群 badge; `label` is the translated text for `tag` */
export function SkillTagBadge({ tag, label, className = "" }: { tag: SkillTag; label: string; className?: string }) {
  return <span className={`badge ${STYLE[tag]} ${className}`} data-skill-tag={tag}>{label}</span>;
}
