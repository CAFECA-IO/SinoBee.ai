import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { currentUser } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import type { Buyer } from "@/components/checkout";
import { AutoDraft, CategorySelect, DiscardProposal, InputFiles, OpenFunding, ProposalFee, SpecChat, SpecDoc, TitleEdit, type SpecView } from "@/components/crowd";
import { creditLeft, feeWaived, proposalPaid } from "@/lib/crowd/proposal";
import { checkoutCards } from "@/lib/crowd/cards";
import type { Screening } from "@/lib/crowd/screening";
import { CATEGORIES, durations, normalizeSpec, sharePrice, specGaps } from "@/lib/crowd/rules";

export const dynamic = "force-dynamic";

export default async function CrowdEditPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ fee?: string }> }) {
  const { locale, id } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me) redirect({ href: `/login?next=/crowd/${id}/edit`, locale });
  const task = await db.task.findUnique({ where: { id }, include: { inputFiles: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } } });
  if (!task || !task.crowdfund || task.userId !== me!.id) notFound();
  if (task.status !== "DRAFT") redirect({ href: `/tasks/${id}`, locale });
  const t = await getTranslations("crowd");
  const screening = task.screening as Screening | null;
  const spec = task.spec ? normalizeSpec(task.spec) : null;
  // subscribers pay no proposal fee and have no credit to run out of
  const waived = await feeWaived(me!.id);
  const paid = proposalPaid(task, waived);
  const left = waived ? Infinity : creditLeft(task);
  const fee = Math.round(config.crowd.proposalFee);
  const mb = (b: number) => Math.round(b / 1048576);
  const chat = ((task.specChat ?? []) as { role: "user" | "assistant"; content: string }[]).map(({ role, content }) => ({ role, content }));
  const step = !paid ? 1 : !spec ? 2 : 3;
  const pay = await checkoutCards(me!.id);
  const feeError = typeof sp.fee === "string" ? sp.fee.slice(0, 200) : null;
  return (
    <div className="container-x py-10">
      <nav className="text-sm text-muted">
        <Link href="/tasks?mine=1" className="hover:text-accent">{t("myList")}</Link>
      </nav>
      <ol className="mt-4 flex flex-wrap gap-2 text-xs" aria-label={t("draft.steps")}>
        {[1, 2, 3].map((n) => (
          <li key={n} className={`rounded-full border px-3 py-1 ${n === step ? "border-accent bg-accent-soft font-semibold text-accent" : n < step ? "border-line text-ok" : "border-line text-muted"}`} aria-current={n === step ? "step" : undefined}>
            {n < step ? "✓ " : `${n}. `}
            {t(`draft.step${n}`)}
          </li>
        ))}
      </ol>
      <div className="mt-4">
        <TitleEdit taskId={task.id} title={task.title} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
        {task.kind === "EVALUATION" && <span className="chip">{t("form.kinds.EVALUATION")}</span>}
        <span className="flex items-center gap-2">
          {t("form.category")} <CategorySelect taskId={task.id} value={task.category} categories={CATEGORIES} />
          <span className="text-xs">{t("draft.aiCategory")}</span>
        </span>
      </div>
      {screening?.decision === "rejected" && (
        <div className="mt-4 space-y-2 rounded-xl bg-err-soft p-4 text-sm text-err">
          <p>{t("screening.rejected", { passed: screening.passed ?? 0, failed: screening.failedCount ?? screening.failed?.length ?? 0, total: screening.total ?? 0, v: screening.checklistVersion ?? 0 })}</p>
          <ul className="list-disc space-y-1 pl-5">
            {screening.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          {screening.notes && screening.notes.length > 0 && (
            <div className="text-ink">
              <div className="text-xs text-muted">{t("screening.notes")}</div>
              <ul className="list-disc space-y-1 pl-5">
                {screening.notes.map((n, i) => (
                  <li key={i} className="whitespace-pre-wrap">{n.text}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!paid ? (
        <div className="mt-6 grid max-w-3xl gap-6">
          <section className="card space-y-3 p-6">
            <h2 className="h3">{t("draft.payTitle")}</h2>
            <p className="whitespace-pre-wrap rounded-xl bg-panel-2 p-4 text-sm">{task.prompt}</p>
            <p className="text-sm text-muted">{t("edit.feeNote")}</p>
            {feeError && <p className="text-sm text-err" role="alert">{feeError}</p>}
            <ProposalFee taskId={task.id} fee={fee} paid={false} buyer={(me!.billing ?? null) as Buyer | null} {...pay} />
          </section>
          <DiscardProposal taskId={task.id} />
        </div>
      ) : !spec ? (
        <div className="mt-6 max-w-3xl">
          <AutoDraft taskId={task.id} />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-6">
            <section className="card space-y-4 p-6">
              <div className="flex items-center justify-between">
                <h2 className="h3">{t("spec.title")}</h2>
                <span className="chip">{t("spec.version", { v: task.specVersion })}</span>
              </div>
              <SpecDoc key={task.specVersion} taskId={task.id} spec={spec as SpecView} evaluation={task.kind === "EVALUATION" ? { method: task.evalMethod, criteria: task.evalCriteria } : undefined} />
            </section>
            <details className="card p-6">
              <summary className="cursor-pointer font-semibold">{t("files.title")} <span className="text-xs font-normal text-muted">（{t("draft.optional")}）</span></summary>
              <div className="mt-4 space-y-3">
                <p className="text-xs text-muted">{t("files.note", { free: mb(config.crowd.freeFileBytes), block: mb(config.crowd.blockBytes), price: sharePrice(), max: mb(config.crowd.maxFileBytes) })}</p>
                <InputFiles taskId={task.id} editable={paid} files={task.inputFiles.map((f) => ({ id: f.id, filename: f.filename, sizeBytes: Number(f.sizeBytes), visibility: f.visibility }))} />
              </div>
            </details>
          </div>
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <section className="card space-y-3 p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{t("chat.title")}</h2>
                <span className="font-mono text-xs text-muted">{waived ? t("edit.waived") : t("edit.creditLeft", { amount: left.toFixed(2) })}</span>
              </div>
              <SpecChat taskId={task.id} chat={chat} canChat={left > 0.01} outOfCredit={left <= 0.01} />
              {left <= 1 && <ProposalFee taskId={task.id} fee={fee} paid buyer={(me!.billing ?? null) as Buyer | null} {...pay} />}
            </section>
            <section className="card space-y-3 p-5">
              <h2 className="font-semibold">{t("open.title")}</h2>
              <OpenFunding taskId={task.id} durations={durations()} p90={spec.estimate.p90Twd} price={sharePrice()} gaps={specGaps(spec)} paid={paid} cards={pay.cards} pendingCard={pay.pendingCard} test={pay.test} buyer={(me!.billing ?? null) as Buyer | null} />
            </section>
            <DiscardProposal taskId={task.id} />
          </aside>
        </div>
      )}
    </div>
  );
}
