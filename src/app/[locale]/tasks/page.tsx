import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { modelLabels } from "@/lib/models";
import { StatusBadge } from "@/components/status-badge";
import { LocalDate } from "@/components/date";
import { sharePrice } from "@/lib/crowd/rules";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "tasks" });
  return { title: t("title") };
}

export default async function TasksPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ mine?: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("tasks");
  const labels = await modelLabels();
  const me = await currentUser();
  const mine = !!(await searchParams).mine && !!me;
  const tc = await getTranslations("crowd");
  const funding = mine
    ? []
    : await db.task.findMany({ where: { crowdfund: true, isPublic: true, status: { in: ["FUNDING", "CHARGING"] } }, include: { pledges: { where: { status: { in: ["ACTIVE", "CHARGED", "FAILED"] } }, select: { amountTwd: true } } }, orderBy: { deadlineAt: "asc" }, take: 50 });
  const tasks = await db.task.findMany({
    where: mine ? { userId: me!.id } : { isPublic: true, kind: "TASK", status: { in: ["COMPLETED", "NEEDS_FUNDING", "RUNNING", "FAILED", "QUEUED", "UNFUNDED", "IN_REVIEW", "DISPUTED"] } },
    include: { user: true, votes: true, _count: { select: { votes: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <div className="container-x py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-muted">{t("lead")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/crowd/new" className="btn-ghost">{tc("new")}</Link>
          <Link href="/tasks/new" className="btn-primary">{t("new")}</Link>
        </div>
      </div>
      {!mine && (
        <section className="mt-8 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="h3">{tc("list.funding")}</h2>
            <Link href="/crowd" className="text-sm text-accent">{tc("explore.title")} →</Link>
          </div>
          <p className="text-sm text-muted">{tc("lead", { price: sharePrice() })}</p>
          {funding.length === 0 && <p className="card p-6 text-center text-sm text-muted">{tc("list.emptyFunding")}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {funding.map((f) => {
              const pledged = f.pledges.reduce((a, p) => a + p.amountTwd, 0);
              return (
                <Link key={f.id} href={`/tasks/${f.id}`} className="card space-y-2 p-4 hover:border-accent">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{f.title}</span>
                    <StatusBadge status={f.status} />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, (pledged / Math.max(1, f.goalTwd ?? 1)) * 100)}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted">
                    <span className="font-mono">{tc("list.progress", { pledged, goal: f.goalTwd ?? 0 })}</span>
                    {f.deadlineAt && <LocalDate value={f.deadlineAt} />}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
      <div className="mt-8 flex gap-2">
        <Link href="/tasks" className={!mine ? "btn-primary !py-2" : "btn-ghost !py-2"}>{t("public")}</Link>
        {me && <Link href="/tasks?mine=1" className={mine ? "btn-primary !py-2" : "btn-ghost !py-2"}>{t("mine")}</Link>}
      </div>
      <div className="card mt-6 divide-y divide-line">
        {tasks.length === 0 && <p className="p-8 text-center text-muted">{mine ? t("emptyMine") : t("emptyPublic")}</p>}
        {tasks.map((task) => {
          const up = task.votes.filter((v) => v.value > 0).length;
          const down = task.votes.length - up;
          return (
            <Link key={task.id} href={task.crowdfund && task.status === "DRAFT" ? `/crowd/${task.id}/edit` : `/tasks/${task.id}`} className="flex flex-wrap items-center gap-4 p-4 hover:bg-panel-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{task.title}</span>
                  {task.kind === "EVALUATION" && <span className="chip">{t("evaluation")}</span>}
                  {task.crowdfund && <span className="chip">{tc("title")}</span>}
                  {mine && !task.isPublic && <span className="chip">🔒 {t("private")}</span>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {labels[task.model] ?? task.model} · <LocalDate value={task.createdAt} />
                </div>
              </div>
              <span className="text-sm text-muted">👍 {up} · 👎 {down}</span>
              {mine && <span className="font-mono text-sm">{Number(task.charged).toFixed(2)} / {Number(task.budget).toFixed(2)}</span>}
              <StatusBadge status={task.status} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
