import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { LocalDate } from "@/components/date";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "tasks" });
  return { title: t("title") };
}

type Row = { id: string; title: string; status: string; kind: string; createdAt: Date; goalTwd: number | null; deadlineAt: Date | null; pledged?: number };

/** My crowdfunds: proposals I started (drafts included) and campaigns I backed. Browsing is on /crowd. */
export default async function TasksPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ mine?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await searchParams;
  const me = await currentUser();
  if (!me) redirect({ href: "/crowd", locale });
  const t = await getTranslations("tasks");
  const tc = await getTranslations("crowd");
  const started = await db.task.findMany({ where: { userId: me!.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const pledges = await db.pledge.findMany({
    where: { userId: me!.id, status: { in: ["ACTIVE", "CHARGED", "FAILED", "RELEASED", "REFUNDED"] } },
    include: { task: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const backed = new Map<string, Row>();
  for (const p of pledges) {
    const cur = backed.get(p.taskId);
    if (cur) cur.pledged = (cur.pledged ?? 0) + p.amountTwd;
    else backed.set(p.taskId, { ...p.task, pledged: p.amountTwd });
  }
  const list = (rows: Row[], empty: string, mineList: boolean) => (
    <div className="card divide-y divide-line">
      {rows.length === 0 && <p className="p-8 text-center text-muted">{empty}</p>}
      {rows.map((r) => (
        <Link key={r.id} href={mineList && r.status === "DRAFT" ? `/crowd/${r.id}/edit` : `/tasks/${r.id}`} className="flex flex-wrap items-center gap-4 p-4 hover:bg-panel-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{r.title}</span>
              {r.kind === "EVALUATION" && <span className="chip">{t("evaluation")}</span>}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {r.goalTwd ? `NT$${r.goalTwd.toLocaleString("en-US")} · ` : ""}
              <LocalDate value={r.createdAt} />
            </div>
          </div>
          {r.pledged != null && <span className="font-mono text-sm">NT${r.pledged.toLocaleString("en-US")}</span>}
          <StatusBadge status={r.status} />
        </Link>
      ))}
    </div>
  );
  return (
    <div className="container-x space-y-10 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-muted">{t("lead")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/crowd" className="btn-ghost">{tc("explore.title")}</Link>
          <Link href="/crowd/new" className="btn-primary">{tc("new")}</Link>
        </div>
      </div>
      <section className="space-y-3">
        <h2 className="h3">{t("started")}</h2>
        {list(started, t("emptyStarted"), true)}
      </section>
      <section className="space-y-3">
        <h2 className="h3">{t("backed")}</h2>
        {list([...backed.values()], t("emptyBacked"), false)}
      </section>
    </div>
  );
}
