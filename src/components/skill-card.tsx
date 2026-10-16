import { Link } from "@/i18n/navigation";
import type { Skill, User } from "@/generated/prisma/client";
import { Stars } from "./stars";
import { Icon } from "./icon";
import { BoltchainMark } from "./boltchain-badge";
import { SkillTagBadge } from "./skill-tag";
import type { SkillTag } from "@/lib/skills/official";

/**
 * title: a localized display name (official skills); tag + tagLabel: the 官方 / 已驗證 / 社群 badge (lib/skills/official);
 * anchored: tooltip for the BOLTCHAIN mark, shown when the latest approved version has a Boltchain certificate
 */
export function SkillCard({ skill, title, tag, tagLabel, anchored }: {
  skill: Skill & { publisher: User };
  title?: string;
  tag?: SkillTag;
  tagLabel?: (tag: SkillTag) => string;
  anchored?: string;
}) {
  const official = tag === "official";
  return (
    <Link href={`/skills/${skill.publisher.publisher}/${skill.name}`} className="card group flex min-w-0 flex-col p-5 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-lg hover:shadow-black/5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon name={official ? "badge" : "hub"} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold group-hover:text-accent">{title ?? skill.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
            <span className="truncate font-mono">{skill.publisher.publisher}/{skill.name}</span>
            {skill.publisher.publisherVerified && <span title="verified publisher" className="text-accent">✔</span>}
          </div>
        </div>
        {skill.latestVersion && <span className="chip flex-none font-mono">v{skill.latestVersion}</span>}
      </div>
      <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted">{skill.description}</p>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
        <Stars value={skill.ratingAvg} count={skill.ratingCount} size="text-xs" />
        <span className="flex items-center gap-2">
          {anchored && <BoltchainMark title={anchored} />}
          {tag && tagLabel && <SkillTagBadge tag={tag} label={tagLabel(tag)} />}
          <span className="flex items-center gap-1"><Icon name="download" className="h-3.5 w-3.5" />{skill.downloads.toLocaleString()}</span>
        </span>
      </div>
    </Link>
  );
}
