import { Link } from "@/i18n/navigation";
import type { Skill, User } from "@/generated/prisma/client";
import { Stars } from "./stars";
import { Icon } from "./icon";
import { SkillIcon } from "./skill-icon";
import { SkillMarks, type Mark } from "./skill-tag";

/**
 * title: a localized display name (official skills); official: kept for callers (the 官方 mark carries it);
 * marks: 官方 / 社群, 已審核 / 待審核 and Boltchain as icons (text on hover) — see skillMarks()
 */
export function SkillCard({ skill, title, marks = [] }: {
  skill: Skill & { publisher: User };
  title?: string;
  official?: boolean;
  marks?: Mark[];
}) {
  return (
    <Link href={`/skills/${skill.publisher.publisher}/${skill.name}`} className="card group flex min-w-0 flex-col p-5 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-lg hover:shadow-black/5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent">
          <SkillIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-snug group-hover:text-accent">{title ?? skill.name}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted">
            <span className="truncate font-mono">{skill.publisher.publisher}/{skill.name}</span>
            {skill.publisher.publisherVerified && <span title="verified publisher" className="flex-none text-accent">✔</span>}
          </div>
        </div>
        <SkillMarks marks={marks} tip="tip-end" />
      </div>
      <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted">{skill.description}</p>
      <div className="mt-4 flex min-w-0 items-center gap-3 border-t border-line pt-3 text-xs text-muted">
        <Stars value={skill.ratingAvg} count={skill.ratingCount} size="text-xs" />
        <span className="ml-auto flex flex-none items-center gap-3">
          {skill.latestVersion && <span className="font-mono">v{skill.latestVersion}</span>}
          <span className="flex items-center gap-1"><Icon name="download" className="h-3.5 w-3.5" />{skill.downloads.toLocaleString()}</span>
        </span>
      </div>
    </Link>
  );
}
