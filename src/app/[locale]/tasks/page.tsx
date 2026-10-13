import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { modelById } from "@/lib/pricing";
import { StatusBadge } from "@/components/status-badge";
import { LocalDate } from "@/components/date";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "tasks" });
  return { title: t("title") };
}

export default async function TasksPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ mine?: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("tasks");
  const me = await currentUser();
  const mine = !!(await searchParams).mine && !!me;
  const tasks = await db.task.findMany({
    where: mine ? { userId: me!.id } : { isPublic: true, kind: "TASK", status: { in: ["COMPLETED", "NEEDS_FUNDING", "RUNNING", "FAILED"] } },
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
        <Link href="/tasks/new" className="btn-primary">{t("new")}</Link>
      </div>
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
            <Link key={task.id} href={`/tasks/${task.id}`} className="flex flex-wrap items-center gap-4 p-4 hover:bg-panel-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{task.title}</span>
                  {task.kind === "EVALUATION" && <span className="chip">{t("evaluation")}</span>}
                  {mine && !task.isPublic && <span className="chip">🔒 {t("private")}</span>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {modelById(task.model)?.label ?? task.model} · <LocalDate value={task.createdAt} />
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
