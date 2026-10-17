import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { currentUser } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import type { Buyer } from "@/components/checkout";
import { CategorySelect, DiscardProposal, InputFiles, OpenFunding, ProposalFee, SpecChat, SpecEditor, type SpecView } from "@/components/crowd";
import { creditLeft } from "@/lib/crowd/proposal";
import type { Screening } from "@/lib/crowd/screening";
import { CATEGORIES, durations, normalizeSpec, sharePrice, specGaps } from "@/lib/crowd/rules";

export const dynamic = "force-dynamic";

export default async function CrowdEditPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me) redirect({ href: `/login?next=/crowd/${id}/edit`, locale });
  const task = await db.task.findUnique({ where: { id }, include: { inputFiles: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } } });
  if (!task || !task.crowdfund || task.userId !== me!.id) notFound();
  if (task.status !== "DRAFT") redirect({ href: `/tasks/${id}`, locale });
  const t = await getTranslations("crowd");
  const screening = task.screening as Screening | null;
  const spec = task.spec ? normalizeSpec(task.spec) : null;
  const paid = Number(task.proposalCreditTwd) > 0;
  const left = creditLeft(task);
  const fee = Math.round(config.crowd.proposalFee);
  const mb = (b: number) => Math.round(b / 1048576);
  const chat = ((task.specChat ?? []) as { role: "user" | "assistant"; content: string }[]).map(({ role, content }) => ({ role, content }));
  return (
    <div className="container-x py-10">
      <nav className="text-sm text-muted">
        <Link href="/tasks?mine=1" className="hover:text-accent">{t("title")}</Link>
      </nav>
      <h1 className="mt-3 text-2xl font-bold sm:text-3xl">{task.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>{t("edit.draft")}</span>
        <span className="flex items-center gap-2">
          {t("form.category")} <CategorySelect taskId={task.id} value={task.category} categories={CATEGORIES} />
        </span>
      </div>
      {screening?.decision === "rejected" && (
        <div className="mt-4 space-y-2 rounded-xl bg-err-soft p-4 text-sm text-err">
          <p>{t("screening.rejected", { passed: screening.passed ?? 0, total: screening.total ?? 0, v: screening.checklistVersion ?? 0 })}</p>
          <ul className="list-disc space-y-1 pl-5">
            {screening.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-8">
          <section className="card space-y-3 p-6">
            <h2 className="h3">{t("chat.title")}</h2>
            <SpecChat taskId={task.id} chat={chat} canChat={paid && left > 0.01} outOfCredit={paid && left <= 0.01} />
          </section>
          <section className="card space-y-3 p-6">
            <div className="flex items-center justify-between">
              <h2 className="h3">{t("spec.title")}</h2>
              {task.specVersion > 0 && <span className="chip">{t("spec.version", { v: task.specVersion })}</span>}
            </div>
            {!spec && <p className="text-sm text-muted">{t("spec.empty")}</p>}
            <SpecEditor key={task.specVersion} taskId={task.id} spec={spec as SpecView | null} />
          </section>
          <section className="card space-y-3 p-6">
            <h2 className="h3">{t("files.title")}</h2>
            <p className="text-xs text-muted">{t("files.note", { free: mb(config.crowd.freeFileBytes), block: mb(config.crowd.blockBytes), price: sharePrice(), max: mb(config.crowd.maxFileBytes) })}</p>
            <InputFiles taskId={task.id} editable={paid} files={task.inputFiles.map((f) => ({ id: f.id, filename: f.filename, sizeBytes: Number(f.sizeBytes), visibility: f.visibility }))} />
          </section>
        </div>
        <aside className="space-y-4">
          <div className="card space-y-3 p-5">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{t("edit.credit")}</span>
              <span className="font-mono text-sm">{paid ? t("edit.creditLeft", { amount: left.toFixed(2) }) : t("edit.creditNone")}</span>
            </div>
            <p className="text-xs text-muted">{t("edit.feeNote")}</p>
            <ProposalFee taskId={task.id} fee={fee} paid={paid} buyer={(me!.billing ?? null) as Buyer | null} />
          </div>
          <div className="card space-y-3 p-5">
            <div className="font-semibold">{t("open.title")}</div>
            <OpenFunding taskId={task.id} durations={durations()} p90={spec?.estimate.p90Twd ?? 0} price={sharePrice()} gaps={specGaps(spec)} paid={paid} />
          </div>
          <DiscardProposal taskId={task.id} />
        </aside>
      </div>
    </div>
  );
}
