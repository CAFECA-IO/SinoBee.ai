import { getTranslations } from "next-intl/server";
import { db, icontains } from "@/lib/db";
import { LocalDate } from "@/components/date";
import { Empty, FilterLink, PageHead, Pager, adminHref } from "@/components/admin/kit";
import { actionKey, actorName, auditDetail, shortId } from "./audit-text";
import type { AdminParams } from "../page";

const PAGE = 50;
/** action groups for the filter: the prefixes each covers */
const AREAS: Record<string, string[]> = {
  review: ["skill.", "tool.", "publisher."],
  people: ["role.", "user.", "owner."],
  money: ["payment.", "payments."],
  pricing: ["price.", "pricing.", "plan."],
  models: ["ai.", "llm."],
  crowd: ["crowd.", "report."],
  settings: ["settings."],
};

export async function Audit({ sp }: { sp: AdminParams }) {
  const t = await getTranslations("admin.au");
  const ta = await getTranslations("admin");
  const area = sp.area && AREAS[sp.area] ? sp.area : "";
  const who = sp.who?.trim().replace(/^@/, "") ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const where = {
    ...(area ? { OR: AREAS[area].map((p) => ({ action: { startsWith: p } })) } : {}),
    ...(who ? { actor: { OR: [{ handle: icontains(who) }, { publisher: icontains(who) }, { account: icontains(who.toLowerCase()) }] } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.adminAudit.count({ where }),
    db.adminAudit.findMany({ where, include: { actor: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
  ]);
  const base = { tab: "audit", area: area || undefined, who: who || undefined };
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="space-y-4">
      <PageHead title={ta("tab.audit")} sub={t("count", { n: total })} />
      <div className="flex flex-wrap items-center gap-2">
        <FilterLink href={adminHref(base, { area: undefined, page: undefined })} on={!area}>{t("all")}</FilterLink>
        {Object.keys(AREAS).map((a) => (
          <FilterLink key={a} href={adminHref(base, { area: a, page: undefined })} on={area === a}>{t(`area.${a}`)}</FilterLink>
        ))}
        <span className="flex-1" />
        <form action="" method="get" className="flex gap-2">
          <input type="hidden" name="tab" value="audit" />
          {area && <input type="hidden" name="area" value={area} />}
          <input className="input !w-56 !py-2" name="who" defaultValue={who} placeholder={t("who")} aria-label={t("who")} />
          <button className="btn-ghost !py-2">{t("go")}</button>
        </form>
      </div>
      {rows.length === 0 ? (
        <Empty>{ta("audit.empty")}</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line"><th className="px-4 py-2.5 font-medium">{ta("audit.when")}</th><th className="px-4 py-2.5 font-medium">{ta("audit.who")}</th><th className="px-4 py-2.5 font-medium">{ta("audit.action")}</th><th className="px-4 py-2.5 font-medium">{ta("audit.detail")}</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const key = actionKey(a.action);
                const d = auditDetail(a.detail);
                return (
                  <tr key={a.id} className="border-b border-line align-top last:border-0" data-audit={a.action}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted"><LocalDate value={a.createdAt} /></td>
                    <td className="whitespace-nowrap px-4 py-2.5">{actorName(a.actor) ?? <span className="text-muted">{t("system")}</span>}</td>
                    <td className="px-4 py-2.5">
                      <div>{t.has(`action.${key}`) ? t(`action.${key}`) : a.action}</div>
                      <div className="font-mono text-[11px] text-muted" title={a.targetId ?? undefined}>{a.action}{a.targetType ? ` · ${a.targetType}:${shortId(a.targetId)}` : ""}</div>
                    </td>
                    <td className="max-w-md px-4 py-2.5 text-xs">
                      {d.changes.map((c) => (
                        <div key={c.key} className="break-words"><span className="text-muted">{c.key}</span> <span className="font-mono line-through decoration-err/60">{c.before}</span> → <span className="font-mono font-semibold">{c.after}</span></div>
                      ))}
                      {d.fields.map(([k, v], i) => (
                        <div key={i} className="break-words">{k && <span className="text-muted">{k}: </span>}<span className="font-mono">{v.length > 160 ? `${v.slice(0, 160)}…` : v}</span></div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={page} pages={pages} href={(p) => adminHref(base, { page: p })} label={{ prev: t("prev"), next: t("next"), of: t("pageOf", { page, pages }) }} />
        </div>
      )}
    </div>
  );
}
