import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { hubPublicKeys } from "@/lib/skills/signing";
import { REVIEW_STATUSES, type ReviewKind, type ReviewStatusFilter, reviewDetail, reviewQueue } from "@/lib/admin/review";
import { changed, hunks } from "@/lib/admin/diff";
import { LocalDate } from "@/components/date";
import { EvaluatorSecurity, VerifyPublisher } from "@/components/admin-actions";
import { ReviewDecision } from "@/components/admin/review-decision";
import { Banner, Empty, FilterLink, PageHead, Tag, adminHref, waited } from "@/components/admin/kit";
import type { AdminParams } from "../page";

export async function Review({ sp }: { sp: AdminParams }) {
  const t = await getTranslations("admin.rv");
  const tw = await getTranslations("admin.wait");
  const ta = await getTranslations("admin");
  const status: ReviewStatusFilter = (REVIEW_STATUSES as string[]).includes(sp.status ?? "") ? (sp.status as ReviewStatusFilter) : "pending";
  const kind: ReviewKind | undefined = sp.kind === "skill" || sp.kind === "tool" ? sp.kind : undefined;
  const q = sp.q?.trim() || undefined;
  const now = new Date();
  const [items, counts] = await Promise.all([
    reviewQueue({ kind, status, q }),
    Promise.all(
      REVIEW_STATUSES.map(async (s) => {
        const st = { in: s === "pending" ? ["PENDING_REVIEW" as const] : s === "approved" ? ["APPROVED" as const] : ["REJECTED" as const, "REVOKED" as const] };
        const [a, b] = await Promise.all([kind === "tool" ? 0 : db.skillVersion.count({ where: { status: st } }), kind === "skill" ? 0 : db.toolVersion.count({ where: { status: st } })]);
        return [s, a + b] as const;
      }),
    ).then((x) => Object.fromEntries(x) as Record<ReviewStatusFilter, number>),
  ]);
  // pending: open the oldest one right away, so the page is a queue to work through
  const selectedId = sp.id ?? (status === "pending" ? items[0]?.id : undefined);
  const selected = selectedId ? items.find((i) => i.id === selectedId) : undefined;
  const selKind: ReviewKind = selected?.kind ?? (sp.kind === "tool" ? "tool" : "skill");
  const d = selectedId ? ((await reviewDetail(selKind, selectedId)) ?? (selKind === "skill" ? await reviewDetail("tool", selectedId) : null)) : null;
  const base = { tab: "review", status: status === "pending" ? undefined : status, kind, q };
  const idx = d ? items.findIndex((i) => i.id === d.id) : -1;
  const next = idx >= 0 ? (items[idx + 1] ?? items[idx - 1]) : undefined;
  const nextHref = adminHref(base, { id: next && next.id !== d?.id ? next.id : undefined });
  const view = sp.view === "source" || sp.view === "files" ? sp.view : "diff";
  const noKey = !hubPublicKeys().length;

  return (
    <div className="space-y-4">
      <PageHead title={ta("tab.review")}>
        <form action="" method="get" className="flex gap-2">
          <input type="hidden" name="tab" value="review" />
          {base.status && <input type="hidden" name="status" value={base.status} />}
          {kind && <input type="hidden" name="kind" value={kind} />}
          <input className="input !w-60 !py-2" name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} />
        </form>
      </PageHead>
      {noKey && <Banner tone="err" title={ta("noKey")} />}
      <div className="flex flex-wrap items-center gap-2">
        {REVIEW_STATUSES.map((s) => (
          <FilterLink key={s} href={adminHref(base, { status: s === "pending" ? undefined : s, id: undefined })} on={status === s}>{t(`status.${s}`)} · {counts[s]}</FilterLink>
        ))}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {(["all", "skill", "tool"] as const).map((k) => (
          <FilterLink key={k} href={adminHref(base, { kind: k === "all" ? undefined : k, id: undefined })} on={(kind ?? "all") === k}>{t(`kind.${k}`)}</FilterLink>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="card overflow-hidden" aria-label={t("list")}>
          {items.length === 0 ? (
            <div className="p-4"><Empty>{q ? t("noMatch") : t(`empty.${status}`)}</Empty></div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {items.map((i) => {
                const on = i.id === d?.id;
                return (
                  <li key={i.id}>
                    <Link
                      href={adminHref(base, { id: i.id })}
                      aria-current={on ? "true" : undefined}
                      className={`block space-y-1 px-4 py-3 ${on ? "bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-panel-2"}`}
                    >
                      <div className="flex items-center gap-2">
                        <Tag tone={i.kind === "skill" ? "info" : "accent"}>{t(`kind.${i.kind}`)}</Tag>
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold">{i.name}@{i.version}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-2 text-xs">
                        <span className={i.findings ? "font-semibold text-warn" : "text-ok"}>{i.findings ? t("findings", { n: i.findings }) : t("clean")}</span>
                        <span className="text-muted">· {status === "pending" ? t("waiting", { t: waited(now.getTime() - i.since.getTime(), tw) }) : <LocalDate value={i.since} withTime={false} />}</span>
                        {i.status === "REVOKED" && <Tag tone="err">{t("revoked")}</Tag>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {d ? (
          <section className="card min-w-0 overflow-hidden" aria-labelledby="rv-title">
            <div className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="rv-title" className="break-all font-mono text-lg font-semibold">{d.name}@{d.version}</h2>
                {d.evaluation && <Tag tone="accent">{ta("evKind")}</Tag>}
                <Tag tone={d.status === "APPROVED" ? "ok" : d.status === "PENDING_REVIEW" ? "warn" : "err"}>{t(`st.${d.status}`)}</Tag>
                <Link href={d.href} className="text-sm text-accent">{t(d.kind === "skill" ? "openHub" : "openTool")}</Link>
              </div>
              {d.description && <p className="text-sm">{d.description}</p>}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span className="flex items-center gap-2">{t("publisher")} @{d.publisher.handle} <VerifyPublisher userId={d.publisher.id} verified={d.publisher.verified} /></span>
                <span>{d.previous ? t("previous", { v: d.previous.version, st: t(`st.${d.previous.status}`) }) : t("firstVersion")}</span>
                <span>{t("submitted")} <LocalDate value={d.since} /></span>
              </div>
              {d.reviewNote && d.status !== "PENDING_REVIEW" && <p className="rounded-xl bg-panel-2 px-3 py-2 text-sm">{t("lastNote")}: {d.reviewNote}</p>}
            </div>

            {d.findings.length > 0 && (
              <div className="mx-5 mb-4 space-y-2 rounded-xl border border-warn/40 bg-warn-soft/40 p-3" role="note">
                <div className="text-sm font-semibold text-warn">{t("findingsTitle", { n: d.findings.length })}</div>
                <ul className="space-y-1.5 text-[13px]">
                  {d.findings.map((f, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <Tag tone="warn">{t.has(`rule.${f.rule}`) ? t(`rule.${f.rule}`) : f.rule}</Tag>
                      <span className="font-mono text-xs">{f.where}</span>
                      <code className="break-all rounded-md border border-warn/30 bg-panel px-1.5 py-0.5 font-mono text-xs">{f.excerpt}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.evaluation && <div className="mx-5 mb-4"><EvaluatorSecurity versionId={d.id} approved={d.status === "APPROVED"} report={d.securityReport as never} /></div>}

            <nav className="flex gap-1 border-b border-line px-5" aria-label={t("views")}>
              {(["diff", "source", "files"] as const)
                .filter((v) => v !== "files" || d.kind === "skill")
                .map((v) => (
                  <Link key={v} href={adminHref({ ...base, id: d.id }, { view: v === "diff" ? undefined : v })} aria-current={view === v ? "page" : undefined} className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === v ? "border-accent font-semibold" : "border-transparent text-muted hover:text-ink"}`}>
                    {v === "diff" ? (d.previous ? t("diffWith", { v: d.previous.version }) : t("diffNone")) : v === "source" ? d.sourceName : t("filesN", { n: d.files.length })}
                  </Link>
                ))}
            </nav>
            <div className="max-h-[60vh] overflow-auto bg-code">
              {view === "source" || (view === "diff" && !d.diff) ? (
                <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[12.5px] leading-relaxed">{d.source}</pre>
              ) : view === "files" ? (
                <ul className="divide-y divide-line font-mono text-xs">
                  {d.files.map((f) => (
                    <li key={f.path} className="flex items-center gap-3 px-4 py-2">
                      <Tag tone={f.change === "added" ? "ok" : f.change === "removed" ? "err" : f.change === "changed" ? "warn" : "muted"}>{t(`file.${f.change}`)}</Tag>
                      <span className="break-all">{f.path}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <DiffView lines={d.diff!} empty={t("noChange")} summary={(n) => t("diffSummary", n)} skipped={(n) => t("skipped", { n })} />
              )}
            </div>

            <div className="border-t border-line bg-panel-2/60 px-5 py-4">
              <ReviewDecision kind={d.kind} versionId={d.id} status={d.status} findings={d.findings.length} nextHref={nextHref} />
              {d.status !== "PENDING_REVIEW" && d.status !== "APPROVED" && <p className="text-sm text-muted">{t("closed", { at: d.reviewedAt ? d.reviewedAt.toISOString().slice(0, 10) : "—" })}</p>}
            </div>
          </section>
        ) : (
          items.length > 0 && <Empty>{t("pick")}</Empty>
        )}
      </div>
    </div>
  );
}

function DiffView({ lines, empty, summary, skipped }: { lines: import("@/lib/admin/diff").DiffLine[]; empty: string; summary: (n: { added: number; removed: number }) => string; skipped: (n: number) => string }) {
  const c = changed(lines);
  if (!c.added && !c.removed) return <p className="p-4 text-sm text-muted">{empty}</p>;
  return (
    <div className="font-mono text-[12.5px] leading-relaxed">
      <div className="sticky top-0 border-b border-line bg-code px-4 py-1.5 text-xs text-muted">{summary(c)}</div>
      {hunks(lines).map((h, i) =>
        "skipped" in h ? (
          <div key={i} className="bg-panel-2 px-4 py-1 text-xs text-muted">⋯ {skipped(h.skipped)}</div>
        ) : (
          h.lines.map((l, j) => (
            <div key={`${i}-${j}`} className={`flex whitespace-pre-wrap break-all ${l.op === "+" ? "bg-accent-soft" : l.op === "-" ? "bg-err-soft" : ""}`}>
              <span className="w-10 shrink-0 select-none pr-2 text-right text-muted">{l.b ?? l.a}</span>
              <span className="w-4 shrink-0 select-none text-muted">{l.op === " " ? "" : l.op}</span>
              <span className="min-w-0 flex-1 pr-4">{l.text || " "}</span>
            </div>
          ))
        ),
      )}
    </div>
  );
}
