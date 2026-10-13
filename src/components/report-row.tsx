import { Link } from "@/i18n/navigation";
import { modelById } from "@/lib/pricing";
import type { EvaluationReport, Skill, SkillVersion, User } from "@/generated/prisma/client";
import { LocalDate } from "./date";

export type ReportWithRefs = EvaluationReport & { requester: User; skillVersion: (SkillVersion & { skill: Skill & { publisher: User } }) | null };

export const scoreColor = (s: number) => (s >= 80 ? "text-ok" : s >= 60 ? "text-warn" : "text-err");

export function ReportRow({ r }: { r: ReportWithRefs }) {
  const who = r.requester.publisher ?? r.requester.handle ?? `${r.requester.account.slice(0, 6)}…${r.requester.account.slice(-4)}`;
  return (
    <Link href={`/benchmarks/reports/${r.id}`} className="flex items-center gap-4 p-4 hover:bg-panel-2">
      <div className={`w-14 text-center text-2xl font-extrabold ${scoreColor(r.score ?? 0)}`}>{r.score?.toFixed(0) ?? "—"}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {r.skillVersion ? (
            <span className="font-mono">
              {r.skillVersion.skill.publisher.publisher}/{r.skillVersion.skill.name}@{r.skillVersion.version}
            </span>
          ) : (
            modelById(r.model)?.label ?? r.model
          )}
          {r.skillVersion && <span className="text-muted"> · {modelById(r.model)?.label ?? r.model}</span>}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {r.method} · {who} · <LocalDate value={r.evaluatedAt} withTime={false} />
        </div>
      </div>
    </Link>
  );
}
