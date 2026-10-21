import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { reportTargets } from "@/lib/admin/reports";
import { ReportActions } from "@/components/admin-actions";
import { LocalDate } from "@/components/date";
import { Empty, PageHead, Tag } from "@/components/admin/kit";

/** Open reports, one card per reported thing (several reports of the same share are judged together) */
export async function Reports() {
  const t = await getTranslations("admin.rp");
  const ta = await getTranslations("admin");
  const rows = await db.report.findMany({ where: { resolvedAt: null }, include: { reporter: true }, orderBy: { createdAt: "asc" }, take: 200 });
  const targets = await reportTargets(rows);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(`${r.targetType}:${r.targetId}`, [...(groups.get(`${r.targetType}:${r.targetId}`) ?? []), r]);
  return (
    <div className="space-y-4">
      <PageHead title={ta("tab.reports")} sub={rows.length ? t("count", { n: rows.length, targets: groups.size }) : undefined} />
      {groups.size === 0 ? (
        <Empty>{t("none")}</Empty>
      ) : (
        [...groups.entries()].map(([key, list]) => {
          const tg = targets.get(key)!;
          const first = list[0];
          return (
            <article key={key} id={`report-${first.id}`} className="card scroll-mt-24 space-y-3 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone="err">{t(`type.${first.targetType}`)}</Tag>
                {tg.gone ? <span className="font-mono text-muted">{tg.title}</span> : <Link href={tg.href} className="font-semibold text-accent">{tg.title}</Link>}
                {tg.owner && <span className="text-xs text-muted">{t("owner", { who: tg.owner })}</span>}
                {tg.gone && <Tag tone="muted">{t("gone")}</Tag>}
                {list.length > 1 && <Tag tone="warn">{t("times", { n: list.length })}</Tag>}
              </div>
              <ul className="space-y-1.5">
                {list.map((r) => (
                  <li key={r.id} className="rounded-xl bg-panel-2 px-3 py-2">
                    <div>{r.reason}</div>
                    <div className="mt-0.5 text-xs text-muted">@{r.reporter.handle ?? r.reporter.account.slice(0, 10)} · <LocalDate value={r.createdAt} /></div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <ReportActions reportId={first.id} targetType={first.targetType} targetId={first.targetId} />
                <span className="text-xs text-muted">{t(`effect.${first.targetType}`)}</span>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}
