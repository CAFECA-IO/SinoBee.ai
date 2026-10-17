import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import type { Buyer } from "@/components/checkout";
import { config } from "@/lib/config";
import { modelLabels } from "@/lib/models";
import { chargeParts } from "@/lib/pricing";
import { canDownload, canView } from "@/lib/tasks/service";
import { redirect } from "@/i18n/navigation";
import { CloseCrowdTask, DisputeActions, InputFiles, PledgePanel, ReviewVote, SpecEditor, TopupForm, type SpecView } from "@/components/crowd";
import { tally } from "@/lib/crowd/review";
import { normalizeAcceptance, normalizeSpec } from "@/lib/crowd/rules";
import { pledgeTotals } from "@/lib/crowd/pledges";
import { activeCards } from "@/lib/crowd/cards";
import { pointBalance } from "@/lib/crowd/points";
import { canReadFile } from "@/lib/crowd/proposal";
import { sharePrice } from "@/lib/crowd/rules";
import { activeSubscription } from "@/lib/retention";
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
  const labels = await modelLabels();
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
  if (task.crowdfund && task.status === "DRAFT" && owner) redirect({ href: `/crowd/${task.id}/edit`, locale });
  const tc = await getTranslations("crowd");
  const crowd = task.crowdfund
    ? await (async () => {
        const totals = await pledgeTotals(task.id);
        const mine = me ? await db.pledge.findMany({ where: { taskId: task.id, userId: me.id }, orderBy: { createdAt: "desc" } }) : [];
        const files = await db.taskInputFile.findMany({ where: { taskId: task.id, deletedAt: null }, orderBy: { createdAt: "asc" } });
        const visible = [];
        for (const f of files) if (await canReadFile(task, f, me?.id)) visible.push({ id: f.id, filename: f.filename, sizeBytes: Number(f.sizeBytes), visibility: f.visibility });
        return {
          totals,
          mine: mine.map((p) => ({ id: p.id, shares: p.shares, amountTwd: p.amountTwd, source: p.source, status: p.status, returnedTwd: p.returnedTwd })),
          backer: mine.some((p) => ["ACTIVE", "CHARGED"].includes(p.status)),
          files: visible,
          cards: me ? (await activeCards(me.id)).map((c) => ({ id: c.id, last4: c.last4 })) : [],
          points: me ? await pointBalance(me.id) : 0,
          hasQuota: me ? !!(await activeSubscription(me.id)) : false,
          spec: task.spec ? normalizeSpec(task.spec) : null,
          revisions: await db.specRevision.findMany({ where: { taskId: task.id }, orderBy: { version: "desc" }, select: { version: true, note: true, createdAt: true } }),
          tally: await tally(task.id, task.reworks),
          myVote: me ? await db.acceptanceVote.findUnique({ where: { taskId_userId_round: { taskId: task.id, userId: me.id, round: task.reworks } } }) : null,
          paid: mine.some((p) => p.status === "CHARGED"),
          topupPledged: task.topupGoalTwd ? (await db.pledge.aggregate({ where: { taskId: task.id, topup: true, status: { in: ["ACTIVE", "CHARGED"] } }, _sum: { amountTwd: true } }))._sum.amountTwd ?? 0 : 0,
          acceptance: normalizeAcceptance(task.acceptance),
        };
      })()
    : null;
  const mayDownload = await canDownload(task, me?.id);
  const up = task.votes.filter((v) => v.value > 0).length;
  const down = task.votes.length - up;
  const myVote = task.votes.find((v) => v.userId === me?.id)?.value ?? 0;
  const parts = chargeParts(
    { tokenUsd: Number(task.tokenCostUsd), vmUsd: Number(task.vmCostUsd), s3Usd: Number(task.s3CostUsd) },
    Number(task.usdTwdRate),
    task.priceBuffer == null ? null : Number(task.priceBuffer),
  );
  const rows = [
    ["tokens", parts.tokens],
    ["vm", parts.vm],
    ["s3", parts.s3],
  ] as const;
  const live = ["QUEUED", "RUNNING", "AWAITING_PAYMENT", "CHARGING"].includes(task.status);
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
              <span>{labels[task.model] ?? task.model}</span>
              {task.skillVersion && (
                <Link className="font-mono text-accent" href={`/skills/${task.skillVersion.skill.publisher.publisher}/${task.skillVersion.skill.name}?v=${task.skillVersion.version}`}>
                  {task.skillVersion.skill.name}@{task.skillVersion.version}
                </Link>
              )}
              <LocalDate value={task.createdAt} />
            </div>
          </header>

          {crowd && (
            <section className="card space-y-3 p-6">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-xs text-muted">{tc("panel.pledged")}</div>
                  <div className="text-2xl font-extrabold">NT${crowd.totals.pledged.toLocaleString("en-US")}</div>
                </div>
                <div className="text-right text-sm text-muted">
                  {tc("panel.goal")} NT${(task.goalTwd ?? 0).toLocaleString("en-US")} · {tc("panel.backers", { n: crowd.totals.backers })}
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full bg-accent" style={{ width: `${Math.min(100, (crowd.totals.pledged / Math.max(1, task.goalTwd ?? 1)) * 100)}%` }} />
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                {task.status === "FUNDING" && task.deadlineAt && (
                  <span>
                    {tc("panel.left")} <Countdown to={task.deadlineAt.toISOString()} /> · {tc("panel.deadline")} <LocalDate value={task.deadlineAt} />
                  </span>
                )}
                {task.status === "CHARGING" && <span>{tc("panel.chargingNote")}</span>}
                {task.status === "UNFUNDED" && <span>{tc("panel.unfundedNote")}</span>}
                {["QUEUED", "RUNNING", "COMPLETED"].includes(task.status) && <span>{tc("panel.fundedNote")}</span>}
                {task.status === "NEEDS_FUNDING" && !task.topupGoalTwd && <span className="text-warn">{tc("panel.needsFundingNote")}</span>}
                {task.status === "IN_REVIEW" && <span>{tc("panel.reviewNote")}</span>}
              </div>
              {task.status === "FUNDING" && task.exitUntil && task.exitUntil > new Date() && (
                <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">{tc("revise.exitUntil", { date: task.exitUntil.toISOString().slice(0, 16).replace("T", " ") + " UTC" })}</p>
              )}
              {task.topupGoalTwd && (
                <div className="space-y-1 rounded-xl border border-warn/50 p-3 text-sm">
                  <div className="font-semibold">{tc("topup.round", { pledged: crowd.topupPledged, goal: task.topupGoalTwd })}</div>
                  {task.topupDeadlineAt && (
                    <div className="text-xs text-muted">
                      {tc("topup.ends")} <LocalDate value={task.topupDeadlineAt} />
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-muted">{tc("panel.leftover")}</p>
            </section>
          )}

          {crowd && ["IN_REVIEW", "DISPUTED"].includes(task.status) && (
            <section className="card space-y-4 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="h3">{tc("review.title")}{task.reworks > 0 && <span className="chip ml-2">{tc("review.rework", { n: task.reworks })}</span>}</h2>
                <span className="text-sm font-semibold">{tc("review.tally", { yes: crowd.tally.yes, no: crowd.tally.no })}</span>
              </div>
              {task.status === "IN_REVIEW" ? (
                <>
                  <p className="text-sm text-muted">{tc("review.intro")}</p>
                  {task.reviewDeadlineAt && (
                    <p className="text-xs text-muted">
                      {tc("review.deadline")} <LocalDate value={task.reviewDeadlineAt} /> · <Countdown to={task.reviewDeadlineAt.toISOString()} />
                    </p>
                  )}
                </>
              ) : (
                <p className="rounded-xl bg-err-soft p-3 text-sm text-err">{tc("review.disputed")}</p>
              )}
              <div>
                <div className="mb-2 text-sm font-semibold">{tc("review.selfCheck")}</div>
                {crowd.acceptance?.criteria.length ? (
                  <ul className="space-y-2 text-sm">
                    {crowd.acceptance.criteria.map((c, i) => (
                      <li key={i} className="flex gap-2">
                        <span className={c.passed ? "text-ok" : "text-err"}>{c.passed ? "✓" : "✗"}</span>
                        <span>
                          {c.criterion}
                          {c.evidence && <span className="block text-xs text-muted">{c.evidence}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{tc("review.noSelfCheck")}</p>
                )}
              </div>
              {task.status === "DISPUTED" && task.reworkNotes && (
                <div>
                  <div className="mb-1 text-sm font-semibold">{tc("review.notes")}</div>
                  <p className="whitespace-pre-wrap text-sm text-muted">{task.reworkNotes}</p>
                </div>
              )}
              <p className="text-xs text-muted">{tc("review.rule", { pct: Math.round(config.crowd.approveShare * 100), n: config.crowd.maxReworks })}</p>
            </section>
          )}

          {crowd && (crowd.spec?.stretch?.length ?? 0) > 0 && (
            <section className="card space-y-2 p-6">
              <h2 className="h3">{tc("stretch.title")}</h2>
              <ul className="space-y-1 text-sm">
                {crowd.spec!.stretch!.map((st, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>{st.title}</span>
                    <span className={i < task.stretchUnlocked ? "text-ok" : "text-muted"}>{i < task.stretchUnlocked ? tc("stretch.unlocked") : tc("stretch.locked", { twd: st.twd })}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

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
            <h2 className="h3">{crowd ? tc("panel.proposal") : t("prompt")}</h2>
            {crowd ? (
              <div className="mt-3">
                <Markdown>{task.prompt}</Markdown>
              </div>
            ) : (
              <p className="mt-3 whitespace-pre-wrap text-sm">{task.prompt}</p>
            )}
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
          {crowd && crowd.revisions.length > 1 && (
            <section className="card space-y-2 p-6">
              <h2 className="h3">{tc("revise.history")}</h2>
              <ul className="space-y-1 text-sm">
                {crowd.revisions.map((r) => (
                  <li key={r.version} className="flex flex-wrap gap-2">
                    <span className="chip">{tc("revise.v", { v: r.version })}</span>
                    <LocalDate value={r.createdAt} />
                    <span className="text-muted">{r.note}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {crowd && crowd.files.length > 0 && (
            <section className="card space-y-3 p-6">
              <h2 className="h3">{tc("panel.files")}</h2>
              <InputFiles taskId={task.id} files={crowd.files} editable={false} />
            </section>
          )}
          <Comments targetType="TASK" targetId={task.id} canReference={!!crowd && (owner || crowd.backer)} />
        </div>

        <aside className="space-y-4">
          {crowd && (
            <div className="card space-y-3 p-5">
              <div className="font-semibold">{tc("panel.back")}</div>
              {me ? (
                <PledgePanel taskId={task.id} status={task.status} price={sharePrice()} cards={crowd.cards} points={crowd.points} hasQuota={crowd.hasQuota} buyer={(me.billing ?? null) as Buyer | null} mine={crowd.mine} />
              ) : (
                <p className="text-sm text-muted">{tc("panel.login")}</p>
              )}
            </div>
          )}
          {crowd && task.status === "IN_REVIEW" && me && (
            <div className="card space-y-3 p-5">
              <div className="font-semibold">{tc("review.title")}</div>
              {crowd.paid ? <ReviewVote taskId={task.id} mine={crowd.myVote ? { approve: crowd.myVote.approve, reason: crowd.myVote.reason } : null} /> : <p className="text-sm text-muted">{tc("review.onlyBackers")}</p>}
            </div>
          )}
          {crowd && task.status === "DISPUTED" && me?.isAdmin && (
            <div className="card space-y-3 p-5">
              <div className="font-semibold">{tc("admin.title")}</div>
              <DisputeActions taskId={task.id} />
            </div>
          )}
          {owner && crowd && task.status === "NEEDS_FUNDING" && !task.topupGoalTwd && (
            <div className="card space-y-3 p-5">
              <div className="font-semibold">{tc("topup.title")}</div>
              <p className="text-xs text-muted">{tc("topup.intro", { days: config.crowd.topupDays })}</p>
              <TopupForm taskId={task.id} price={sharePrice()} />
            </div>
          )}
          {owner && crowd && task.status === "NEEDS_FUNDING" && <CloseCrowdTask taskId={task.id} />}
          {owner && crowd && task.status === "FUNDING" && (
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold">{tc("revise.title")}</summary>
              <p className="mt-2 text-xs text-muted">{tc("revise.intro", { hours: config.crowd.exitHours })}</p>
              <div className="mt-3">
                <SpecEditor taskId={task.id} spec={crowd.spec as SpecView | null} revise />
              </div>
            </details>
          )}
          {owner && (
            <>
              <div className="card space-y-3 p-5">
                <div className="font-semibold">{t("billing")}</div>
                <dl className="space-y-1 text-sm">
                  {rows.map(([k, twd]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-muted">{t(`cost.${k}`)}</dt>
                      <dd className="text-right font-mono">
                        {twd.toFixed(2)}
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
              {!crowd && <TaskOwnerActions taskId={task.id} status={task.status} minTopUp={config.payments.minTopUp} minBudget={config.payments.minTaskBudget} title={task.title} buyer={(me?.billing ?? null) as Buyer | null} />}
            </>
          )}
          {mayDownload && (
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
              <p className="text-xs text-muted">{task.crowdfund ? tc("panel.retention", { days: config.crowd.resultsDays }) : t("retentionNote", { days: config.retention.freeDays })}</p>
            </div>
          )}
          {!mayDownload && task.isPublic && !crowd && <p className="card p-5 text-sm text-muted">{t("publicNote")}</p>}
        </aside>
      </div>
    </div>
  );
}
