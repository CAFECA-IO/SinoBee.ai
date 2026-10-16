import { Link } from "@/i18n/navigation";
import type { Skill, User } from "@/generated/prisma/client";
import { Stars } from "./stars";
import { Icon } from "./icon";

/** title: a localized display name (official skills); official: published by the SinoBee team */
export function SkillCard({ skill, title, official, officialLabel }: {
  skill: Skill & { publisher: User };
  title?: string;
  official?: boolean;
  officialLabel?: string;
}) {
  return (
    <Link href={`/skills/${skill.publisher.publisher}/${skill.name}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-lg hover:shadow-black/5">
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
          {official && officialLabel && <span className="badge bg-accent-soft text-accent">{officialLabel}</span>}
          <span className="flex items-center gap-1"><Icon name="download" className="h-3.5 w-3.5" />{skill.downloads.toLocaleString()}</span>
        </span>
      </div>
    </Link>
  );
}
