import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocalDate } from "@/components/date";
import { USER_FILTERS, type UserFilter, userCounts, userDetail, userList } from "@/lib/admin/users";
import { QuotaReset, UserPermissions } from "@/components/admin/user-actions";
import { DetailPanel, Empty, FilterLink, KV, PageHead, Pager, PanelSection, Split, Tag, adminHref, twd } from "@/components/admin/kit";
import type { CurrentUser } from "@/lib/auth";
import type { AdminParams } from "../page";

const ROLE_TONE = { SUPERADMIN: "ok", ADMIN: "accent", USER: "muted" } as const;
const PAY_TONE = { CONFIRMED: "ok", PENDING: "warn", FAILED: "err", EXPIRED: "muted", REFUNDED: "info" } as const;

export async function Users({ me, superAdmin, sp }: { me: CurrentUser; superAdmin: boolean; sp: AdminParams }) {
  const t = await getTranslations("admin.us");
  const tu = await getTranslations("admin.users");
  const ta = await getTranslations("admin");
  const tacc = await getTranslations("account");
  const locale = await getLocale();
  const filter: UserFilter = (USER_FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as UserFilter) : "all";
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const [counts, list, detail] = await Promise.all([userCounts(), userList({ filter, q, page, locale }), sp.id ? userDetail(sp.id, locale) : Promise.resolve(null)]);
  const base = { tab: "users", filter: filter === "all" ? undefined : filter, q, page: page > 1 ? String(page) : undefined };
  const from = (list.page - 1) * 25 + 1;

  const table = (
    <section className="card overflow-hidden">
      {list.rows.length === 0 ? (
        <div className="p-4"><Empty>{tu("none")}</Empty></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-medium">{t("col.user")}</th>
                <th className="px-4 py-2.5 font-medium">{t("col.plan")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("col.usage")}</th>
                <th className="px-4 py-2.5 font-medium">{t("col.payments")}</th>
                <th className="px-4 py-2.5 font-medium">{t("col.last")}</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((u) => {
                const on = u.id === sp.id;
                return (
                  <tr key={u.id} className={`border-b border-line last:border-0 ${on ? "bg-accent-soft" : "hover:bg-panel-2"}`} data-user={u.account}>
                    <td className="px-4 py-2.5">
                      <Link href={adminHref(base, { id: u.id })} className="flex flex-wrap items-center gap-2 font-semibold">
                        @{u.handle ?? "—"}
                        {u.role !== "USER" && <Tag tone={ROLE_TONE[u.role]}>{tu(`role.${u.role}`)}</Tag>}
                        {u.disabled && <Tag tone="err">{t("disabled")}</Tag>}
                        {u.id === me.id && <span className="chip">{tu("you")}</span>}
                      </Link>
                      <div className="font-mono text-[11px] text-muted">{u.account.slice(0, 8)}…{u.account.slice(-6)}</div>
                    </td>
                    <td className="px-4 py-2.5">{u.plan ?? <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{u.usage30Twd > 0 ? twd(u.usage30Twd, 1) : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2.5">
                      {u.paidTwd > 0 && <span className="font-mono">{twd(u.paidTwd)}</span>}
                      {u.pending > 0 && <Tag tone="warn" className="ml-1">{t("pendingN", { n: u.pending })}</Tag>}
                      {u.failed > 0 && <Tag tone="err" className="ml-1">{t("failedN", { n: u.failed })}</Tag>}
                      {!u.paidTwd && !u.pending && !u.failed && <span className="text-muted">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted"><LocalDate value={u.lastLoginAt} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={list.page} pages={list.pages} href={(p) => adminHref(base, { page: p > 1 ? p : undefined, id: undefined })} label={{ prev: t("prev"), next: t("next"), of: t("range", { from, to: from + list.rows.length - 1, total: list.total }) }} />
      {list.pages <= 1 && list.total > 0 && <p className="border-t border-line px-4 py-2.5 text-xs text-muted">{t("range", { from, to: from + list.rows.length - 1, total: list.total })}</p>}
    </section>
  );

  let panel: React.ReactNode = null;
  if (detail) {
    const u = detail.user;
    const pct = detail.allowanceTwd > 0 ? Math.min(100, (detail.usage30Twd / detail.allowanceTwd) * 100) : 0;
    panel = (
      <DetailPanel
        title={<span className="flex flex-wrap items-center gap-2">@{u.handle ?? u.publisher ?? "—"}{u.role !== "USER" && <Tag tone={ROLE_TONE[u.role]}>{tu(`role.${u.role}`)}</Tag>}{u.disabledAt && <Tag tone="err">{t("disabled")}</Tag>}</span>}
        sub={<><span className="break-all font-mono">{u.account}</span><br />{t("joined")} <LocalDate value={u.createdAt} withTime={false} /> · {tu("lastLogin")} <LocalDate value={u.lastLoginAt} />{u.publisher ? ` · ${t("publisherId", { id: u.publisher })}` : ""}</>}
        closeHref={adminHref(base, { id: undefined })}
        closeLabel={t("close")}
      >
        <PanelSection title={t("subUsage")}>
          <KV
            rows={[
              [t("plan"), detail.current ? `${detail.current.plan} · ${t("until", { d: detail.current.endsAt.toISOString().slice(0, 10) })}${detail.upcoming ? ` · ${t("upcoming", { n: detail.upcoming })}` : ""}` : t("freePlan")],
              [t("usage30"), `${twd(detail.usage30Twd, 1)}${detail.allowanceTwd ? ` / ${twd(detail.allowanceTwd)} (${Math.round(pct)}%)` : ""} · ${t("calls", { n: detail.calls30 })}`],
              [t("window6h"), detail.quota.l6Twd > 0 ? `${twd(detail.quota.w6Twd, 2)} / ${twd(detail.quota.l6Twd, 2)}` : "—"],
              [t("windowWeek"), detail.quota.l168Twd > 0 ? <>{twd(detail.quota.w168Twd, 2)} / {twd(detail.quota.l168Twd, 2)} <span className="text-muted">({t("weekDetail", { grant: twd(detail.quota.grantTwd, 2), carry: twd(detail.quota.carryInTwd, 2), cap: twd(detail.quota.capTwd, 2) })})</span> · {t("weekResets")} <LocalDate value={detail.quota.weekEndsAt} /></> : "—"],
              [t("level"), detail.level ? t("levelLine", { n: detail.level.n, months: detail.level.months, bonus: Math.round(detail.level.bonus * 100) }) : "—"],
              [t("autoRenew"), u.autoRenew ? t("on") : t("off")],
              ...(detail.quota.reset6hAt || detail.quota.resetWeekAt
                ? [[t("lastReset"), <>{detail.quota.reset6hAt && <>{t("reset6h")} <LocalDate value={detail.quota.reset6hAt} /> </>}{detail.quota.resetWeekAt && <>{t("resetWeek")} <LocalDate value={detail.quota.resetWeekAt} /></>}</>] as [string, React.ReactNode]]
                : []),
              [t("topModels"), detail.topModels.length ? detail.topModels.map((m) => `${m.modelId.split("/").slice(1).join("/")} ${Math.round(m.share * 100)}%`).join("、") : "—"],
            ]}
          />
          {detail.allowanceTwd > 0 && (
            <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="img" aria-label={`${Math.round(pct)}%`}>
              <div className={`h-full ${pct >= 90 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          <QuotaReset userId={u.id} />
        </PanelSection>
        <PanelSection title={t("payments")} action={<Link className="text-xs text-accent" href={`/admin?tab=payments&q=${encodeURIComponent(u.account)}`}>{t("allPayments")}</Link>}>
          {detail.payments.length === 0 ? (
            <p className="text-muted">—</p>
          ) : (
            <ul className="space-y-1.5">
              {detail.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted"><LocalDate value={p.createdAt} withTime={false} /></span>
                  <Link className="min-w-0 flex-1 truncate" href={`/admin?tab=payments&id=${p.id}`}>{tacc(`purpose.${p.purpose}`)}</Link>
                  <span className="font-mono">{twd(p.amountTwd ?? 0)}</span>
                  <Tag tone={PAY_TONE[p.status]}>{tacc(`pstatus.${p.status}`)}</Tag>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>
        {(detail.skills.length > 0 || detail.tools.length > 0) && (
          <PanelSection title={t("published")}>
            <ul className="space-y-1 font-mono text-xs">
              {detail.skills.map((s) => <li key={`s-${s.name}`}>{u.publisher}/{s.name}{s.latestVersion ? `@${s.latestVersion}` : ""} <span className="text-muted">· {t("skill")}</span></li>)}
              {detail.tools.map((s) => <li key={`t-${s.name}`}>{u.publisher ?? ""}/{s.name}{s.latestVersion ? `@${s.latestVersion}` : ""} <span className="text-muted">· {t("tool")}</span></li>)}
            </ul>
          </PanelSection>
        )}
        <PanelSection title={t("permissions")}>
          <UserPermissions userId={u.id} account={u.account} role={u.role} disabled={!!u.disabledAt} disabledReason={u.disabledReason} superAdmin={superAdmin} self={u.id === me.id} />
        </PanelSection>
      </DetailPanel>
    );
  }

  return (
    <div className="space-y-4">
      <PageHead title={ta("tab.users")}>
        <form action="" method="get" className="flex gap-2">
          <input type="hidden" name="tab" value="users" />
          {base.filter && <input type="hidden" name="filter" value={base.filter} />}
          <input className="input !w-72 !py-2" name="q" defaultValue={q} placeholder={tu("search")} aria-label={tu("search")} />
          <button className="btn-ghost !py-2">{tu("searchGo")}</button>
        </form>
      </PageHead>
      <div className="flex flex-wrap gap-2">
        {USER_FILTERS.map((f) => (
          <FilterLink key={f} href={adminHref({ tab: "users", q }, { filter: f === "all" ? undefined : f })} on={filter === f}>{t(`filter.${f}`)} {counts[f]}</FilterLink>
        ))}
      </div>
      <Split list={table} detail={panel} />
    </div>
  );
}
