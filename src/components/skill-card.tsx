import { Link } from "@/i18n/navigation";
import type { Skill, User } from "@/generated/prisma/client";
import { Stars } from "./stars";

export function SkillCard({ skill }: { skill: Skill & { publisher: User } }) {
  return (
    <Link href={`/skills/${skill.publisher.publisher}/${skill.name}`} className="card group flex flex-col p-5 transition hover:border-accent">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-semibold group-hover:text-accent">{skill.name}</div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            {skill.publisher.publisher}
            {skill.publisher.publisherVerified && <span title="verified publisher" className="text-accent">✔</span>}
          </div>
        </div>
        {skill.latestVersion && <span className="chip font-mono">v{skill.latestVersion}</span>}
      </div>
      <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted">{skill.description}</p>
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <Stars value={skill.ratingAvg} count={skill.ratingCount} size="text-xs" />
        <span>↓ {skill.downloads.toLocaleString()}</span>
      </div>
    </Link>
  );
}
