import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { modelById } from "@/lib/pricing";
import { canView } from "@/lib/tasks/service";
import { StatusBadge } from "@/components/status-badge";
import { Markdown } from "@/components/markdown";
import { LocalDate } from "@/components/date";
import { Comments } from "@/components/comments";
import { TaskOwnerActions, TaskVote, AutoRefresh, Countdown } from "@/components/task-actions";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: P) {
  const { id } = await params;
  const t = await db.task.findUnique({ where: { id }, select: { title: true, isPublic: true } });
  return t?.isPublic ? { title: t.title } : { title: "Task", robots: { index: false } };
}

export default async function TaskPage({ params }: P) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("task");
  const me = await currentUser();
  const task = await db.task.findUnique({
    where: { id },
    include: {
      user: true,
      artifacts: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "asc" }, take: 500 },
      votes: true,
      report: true,
      skillVersion: { include: { skill: { include: { publisher: true } } } },
    },
  });
  if (!task || !canView(task, me?.id)) notFound();
  const owner = me?.id === task.userId;
  const up = task.votes.filter((v) => v.value > 0).length;
  const down = task.votes.length - up;
  const myVote = task.votes.find((v) => v.userId === me?.id)?.value ?? 0;
  const markup = config.pricing.markup;
  const rate = Number(task.usdTwdRate);
  const rows = [
    ["tokens", Number(task.tokenCostUsd)],
    ["vm", Number(task.vmCostUsd)],
    ["s3", Number(task.s3CostUsd)],
  ] as const;
  const live = ["QUEUED", "RUNNING", "AWAITING_PAYMENT"].includes(task.status);
  const who = task.user.publisher ?? task.user.handle ?? `${task.user.account.slice(0, 6)}…${task.user.account.slice(-4)}`;

  return (
    <div className="container-x py-10">
      {live && <AutoRefresh taskId={task.id} status={task.status} />}
      <nav className="text-sm text-muted">
        <Link href={owner ? "/tasks?mine=1" : "/tasks"} className="hover:text-accent">{t("back")}</Link>
      </nav>
      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold sm:text-3xl">{task.title}</h1>
              <StatusBadge status={task.status} />
              {!task.isPublic && <span className="chip">🔒 {t("private")}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span>{t("by")} {who}</span>
              <span>{modelById(task.model)?.label ?? task.model}</span>
              {task.skillVersion && (
                <Link className="font-mono text-accent" href={`/skills/${task.skillVersion.skill.publisher.publisher}/${task.skillVersion.skill.name}?v=${task.skillVersion.version}`}>
                  {task.skillVersion.skill.name}@{task.skillVersion.version}
                </Link>
              )}
              <LocalDate value={task.createdAt} />
            </div>
          </header>

          {owner && task.status === "NEEDS_FUNDING" && (
            <div className="rounded-2xl border border-warn/50 bg-warn-soft p-5 text-warn">
              <b>{t("needsFundingTitle")}</b>
              <p className="mt-1 text-sm">{t("needsFundingBody", { days: config.retention.freeDays })}</p>
            </div>
          )}
          {task.report && (
            <Link href={`/benchmarks/reports/${task.report.id}`} className="card flex items-center justify-between p-5 hover:border-accent">
              <span className="font-semibold">{t("viewReport")}</span>
              <span className="text-2xl font-extrabold text-accent">{task.report.score?.toFixed(0)}</span>
            </Link>
          )}

          <section className="card p-6">
            <h2 className="h3">{t("prompt")}</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm">{task.prompt}</p>
            {task.evalCriteria && (
              <>
                <h3 className="mt-5 font-semibold">{t("criteria")}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm">{task.evalCriteria}</p>
              </>
            )}
          </section>

          {task.summary && (
            <section className="card p-6">
              <h2 className="h3 mb-3">{t("summary")}</h2>
              <Markdown>{task.summary}</Markdown>
            </section>
          )}
          {task.error && owner && <pre className="codeblock whitespace-pre-wrap text-err">{task.error}</pre>}

          <section>
            <h2 className="h3">{t("log")}</h2>
            <ol className="mt-3 space-y-1 border-l border-line pl-4 text-sm">
              {task.events
                .filter((e) => owner || e.type !== "download")
                .map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-2 h-2 w-2 rounded-full bg-accent" />
                    <span className="mr-2 font-mono text-xs text-muted">
                      <LocalDate value={e.createdAt} />
                    </span>
                    {e.message}
                  </li>
                ))}
              {task.events.length === 0 && <li className="text-muted">{t("noEvents")}</li>}
            </ol>
          </section>

          {["COMPLETED", "FAILED", "NEEDS_FUNDING"].includes(task.status) && (
            <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <div className="font-semibold">{t("rateResult")}</div>
                <div className="text-sm text-muted">👍 {up} · 👎 {down}</div>
              </div>
              {me ? <TaskVote taskId={task.id} mine={myVote} /> : <span className="text-sm text-muted">{t("loginToRate")}</span>}
            </section>
          )}
          <Comments targetType="TASK" targetId={task.id} />
        </div>

        <aside className="space-y-4">
          {owner && (
            <>
              <div className="card space-y-3 p-5">
                <div className="font-semibold">{t("billing")}</div>
                <dl className="space-y-1 text-sm">
                  {rows.map(([k, usd]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-muted">{t(`cost.${k}`)}</dt>
                      <dd className="text-right font-mono">
                        {(usd * markup * rate).toFixed(2)}
                      </dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-line pt-2 font-semibold">
                    <dt>{t("charged")}</dt>
                    <dd className="font-mono">{Number(task.charged).toFixed(2)} TWD</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("budget")}</dt>
                    <dd className="font-mono">{Number(task.budget).toFixed(2)} TWD</dd>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, (Number(task.charged) / Math.max(1, Number(task.budget))) * 100)}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>{Number(task.inputTokens).toLocaleString()} in / {Number(task.outputTokens).toLocaleString()} out tokens</span>
                    <span>{Math.round(task.vmSeconds / 60)} min</span>
                  </div>
                </dl>
                <p className="text-[11px] text-muted">{t("rateNote")}</p>
              </div>
              <TaskOwnerActions taskId={task.id} status={task.status} minTopUp={config.payments.minTopUp} minBudget={config.payments.minTaskBudget} title={task.title} />
            </>
          )}
          {owner && (
            <div className="card space-y-3 p-5">
              <div className="font-semibold">{t("results")}</div>
              {task.artifacts.length === 0 && <p className="text-sm text-muted">{t("noResults")}</p>}
              {task.artifacts.map((a) => {
                const gone = !!a.deletedAt || (!!a.expiresAt && a.expiresAt < new Date());
                return (
                  <div key={a.id} className="rounded-xl border border-line p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">{a.filename}</span>
                      {a.partial && <span className="badge bg-warn-soft text-warn">{t("partial")}</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted">{(Number(a.sizeBytes) / 1024).toFixed(1)} KB · sha256 {a.sha256.slice(0, 12)}…</div>
                    {gone ? (
                      <p className="mt-2 text-xs text-err">{t("expired")}</p>
                    ) : (
                      <>
                        <a href={`/api/tasks/${task.id}/download/${a.id}`} className="btn-primary mt-2 w-full !py-2">{t("download")}</a>
                        {a.expiresAt && (
                          <p className="mt-1 text-xs text-warn">
                            {t("expiresIn")} <Countdown to={a.expiresAt.toISOString()} />
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-muted">{t("retentionNote", { days: config.retention.freeDays })}</p>
            </div>
          )}
          {!owner && task.isPublic && <p className="card p-5 text-sm text-muted">{t("publicNote")}</p>}
        </aside>
      </div>
    </div>
  );
}
