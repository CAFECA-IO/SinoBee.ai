import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { AutoRefresh, DisputeActions, ScreeningActions, ScreeningProgress, ScreeningResult } from "@/components/crowd";
import { LocalDate } from "@/components/date";
import { Empty, PageHead, Tag, twd } from "@/components/admin/kit";

type ScreeningData = { decision: string; aiDecision?: "approve" | "rejected"; progress?: { done: number; total: number; items: number }; error?: string; passed?: number; failedCount?: number; total?: number; checklistVersion?: number; reasons: string[]; failed?: unknown[]; notes?: { text: string; at: string }[] };

/** Crowdfunding: proposals in screening, proposals sent back, disputes to decide, and the latest results */
export async function Crowd() {
  const t = await getTranslations("admin.cr");
  const ta = await getTranslations("admin");
  const tc = await getTranslations("crowd.screening");
  const [waiting, disputes, recent] = await Promise.all([
    db.task.findMany({ where: { status: "SCREENING" }, include: { user: true }, orderBy: { updatedAt: "asc" }, take: 100 }),
    db.task.findMany({ where: { status: "DISPUTED" }, include: { user: true, _count: { select: { pledges: true } } }, orderBy: { updatedAt: "asc" }, take: 100 }),
    db.taskEvent.findMany({
      where: { type: { in: ["screening.rejected", "screening.passed", "funding.opened"] }, task: { crowdfund: true } },
      include: { task: { select: { id: true, title: true, status: true, screening: true, user: { select: { handle: true, account: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
  ]);
  const seen = new Set<string>();
  const latest = recent.filter((e) => !(e.type === "funding.opened" && (e.data as { by?: string } | null)?.by === "ai") && !seen.has(e.taskId) && (seen.add(e.taskId), true));
  const sentBack = latest.filter((e) => e.type === "screening.rejected" && e.task.status === "DRAFT" && (e.task.screening as ScreeningData | null)?.decision === "rejected");
  const others = latest.filter((e) => !sentBack.includes(e));
  const busy = waiting.some((r) => ["queued", "running", "pending"].includes((r.screening as ScreeningData | null)?.decision ?? "queued"));
  const who = (u: { handle: string | null; account: string }) => `@${u.handle ?? u.account.slice(0, 10)}`;

  return (
    <div className="space-y-6">
      <AutoRefresh active={busy} />
      <PageHead title={ta("tab.crowd")} sub={t("sub", { s: waiting.length, d: disputes.length })} />

      <section className="space-y-3" aria-labelledby="cr-disputes">
        <h2 id="cr-disputes" className="h3">{t("disputes")} · {disputes.length}</h2>
        {disputes.length === 0 ? (
          <Empty>{t("noDisputes")}</Empty>
        ) : (
          disputes.map((r) => (
            <article key={r.id} id={`task-${r.id}`} className="card scroll-mt-24 grid gap-4 p-4 text-sm md:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="info">{t("dispute")}</Tag>
                  <Link href={`/tasks/${r.id}`} className="font-semibold text-accent">{r.title}</Link>
                </div>
                <div className="text-xs text-muted">{who(r.user)} · {twd(r.goalTwd ?? 0)} · {t("backers", { n: r._count.pledges })} · <LocalDate value={r.updatedAt} /></div>
                {r.reworkNotes && <p className="whitespace-pre-wrap rounded-xl bg-panel-2 px-3 py-2">{r.reworkNotes}</p>}
                <p className="text-xs text-muted">{t("disputeHelp")}</p>
              </div>
              <DisputeActions taskId={r.id} />
            </article>
          ))
        )}
      </section>

      <section className="space-y-3" aria-labelledby="cr-screening">
        <h2 id="cr-screening" className="h3">{tc("inProgress")} · {waiting.length}</h2>
        {waiting.length === 0 ? (
          <Empty>{t("noScreening")}</Empty>
        ) : (
          waiting.map((r) => {
            const sc = r.screening as ScreeningData | null;
            return (
              <article key={r.id} id={`task-${r.id}`} className="card scroll-mt-24 space-y-3 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/tasks/${r.id}`} className="font-semibold text-accent">{r.title}</Link>
                  <span className="text-xs text-muted">{who(r.user)} · {twd(r.goalTwd ?? 0)} · {r.selfFunded ? ta("screening.self") : t("days", { n: r.durationDays ?? 0 })} · <LocalDate value={r.updatedAt} /></span>
                </div>
                {sc?.decision === "running" && sc.progress ? (
                  <ScreeningProgress done={sc.progress.done} total={sc.progress.total} items={sc.progress.items} />
                ) : sc?.decision === "review" ? (
                  <p className={`font-semibold ${sc.aiDecision === "approve" ? "text-ok" : "text-err"}`}>{sc.aiDecision === "approve" ? tc("aiApprove") : tc("aiReject")}</p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-muted">{sc?.decision === "pending" ? tc("waiting") : tc("queued")}</p>
                    {sc?.decision === "pending" && sc.error && <p className="break-words font-mono text-xs text-warn">{tc("lastError", { error: sc.error })}</p>}
                  </div>
                )}
                {sc?.decision === "review" && <ScreeningResult screening={sc} />}
                {sc?.decision !== "review" && sc?.notes && sc.notes.length > 0 && <ScreeningResult screening={{ ...sc, total: undefined, reasons: [] }} />}
                <ScreeningActions taskId={r.id} stage={sc?.decision === "review" ? "review" : "busy"} aiDecision={sc?.aiDecision} selfFunded={r.selfFunded} />
              </article>
            );
          })
        )}
      </section>

      {sentBack.length > 0 && (
        <section className="space-y-3" aria-labelledby="cr-back">
          <h2 id="cr-back" className="h3">{tc("sentBack")} · {sentBack.length}</h2>
          {sentBack.map((e) => (
            <article key={e.id} className="card space-y-3 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone="err">{t("sentBackTag")}</Tag>
                <Link href={`/tasks/${e.task.id}`} className="font-semibold text-accent">{e.task.title}</Link>
                <span className="text-xs text-muted">{who(e.task.user)} · <LocalDate value={e.createdAt} /></span>
              </div>
              <ScreeningResult screening={e.task.screening as ScreeningData} />
              <ScreeningActions taskId={e.task.id} stage="sentBack" />
            </article>
          ))}
        </section>
      )}

      {others.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer px-4 py-3 font-semibold">{t("recent")} · {others.length}</summary>
          <ul className="divide-y divide-line border-t border-line text-sm">
            {others.map((e) => {
              const d = e.data as { passed?: number; failed?: string[] | number; total?: number; v?: number } | null;
              const sc = e.task.screening as ScreeningData | null;
              const ok = e.type !== "screening.rejected";
              const failed = Array.isArray(d?.failed) ? d.failed.length : (d?.failed ?? 0);
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <Tag tone={ok ? "ok" : "err"}>{ok ? t("passed") : t("rejected")}</Tag>
                  <Link href={`/tasks/${e.task.id}`} className="text-accent">{e.task.title}</Link>
                  {d?.total ? <span className="text-xs text-muted">{tc("result", { passed: d.passed ?? 0, failed, total: d.total, v: d.v ?? sc?.checklistVersion ?? 0 })}</span> : null}
                  <span className="ml-auto text-xs text-muted"><LocalDate value={e.createdAt} /></span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
