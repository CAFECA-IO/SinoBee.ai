import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocalDate } from "@/components/date";
import { PageHead } from "@/components/admin/kit";
import { DraftsCard } from "@/components/admin-health";
import { SETTING } from "@/lib/settings/registry";
import { siteHealth, type Level } from "./health-data";

const MARK: Record<Level, string> = { ok: "●", warn: "▲", bad: "■", off: "○" };
const PILL: Record<Level, string> = {
  ok: "bg-accent-soft text-ok",
  warn: "bg-[#fff1dc] text-[#7a4300] dark:bg-[#3a2a10] dark:text-[#f4c98a]",
  bad: "bg-err-soft text-err",
  off: "bg-panel-2 text-muted",
};

/**
 * 站台健康 (design: 建議組合, the entry): what needs attention, changes not applied yet, restart-only changes
 * waiting for a restart, and every service in the same four states. Each item links to the exact place to fix it.
 */
export async function Health({ locale }: { locale: string }) {
  const t = await getTranslations("admin.health");
  const to = await getTranslations("admin.ov");
  const ts = await getTranslations("admin.settings");
  const zh = locale.startsWith("zh");
  const h = await siteHealth();
  const bad = h.issues.filter((i) => i.level === "bad").length;
  const warn = h.issues.length - bad;
  const where = (key?: string) => {
    const d = key ? SETTING[key] : undefined;
    return d ? `${t("settings")} › ${ts(`group.${d.group}`)} › ${zh ? d.label.zh : d.label.en}` : "";
  };
  const state = (l: Level) => t(`state.${l}`);
  return (
    <div className="space-y-5">
      <PageHead title={t("title")} sub={t("summary", { bad, warn, restart: h.restart.length })}>
        <span className="text-xs text-muted">{t("checkedAt")} <LocalDate value={h.at} /></span>
        <Link href="/admin?tab=health" className="btn-ghost !py-1.5">{t("recheck")}</Link>
      </PageHead>

      <section className="card overflow-hidden" aria-labelledby="h-issues">
        <h2 id="h-issues" className="h3 border-b border-line px-4 py-3">{t("issues")}</h2>
        {h.issues.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ok">● {t("allGood")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {h.issues.map((i) => {
              const check = i.kind.startsWith("check.");
              const title = check ? to(`${i.kind}.title`) : t(`issue.${i.kind}.title`, i.values ?? {});
              const fix = check ? to(`${i.kind}.fix`) : t(`issue.${i.kind}.fix`, i.values ?? {});
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5" data-issue={i.id}>
                  <span className={`badge shrink-0 font-semibold ${PILL[i.level]}`}>{MARK[i.level]} {state(i.level)}</span>
                  <div className="min-w-0 flex-[1_1_320px]">
                    <div className="font-semibold">{title}</div>
                    <div className="text-xs text-muted">{fix}</div>
                    {i.setting && <div className="mt-0.5 text-xs text-muted">{where(i.setting)}</div>}
                  </div>
                  <Link href={i.href} className={i.level === "bad" ? "btn-primary !py-2" : "btn-ghost !py-2"}>{t("fix")}</Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <DraftsCard />
        <section className="card space-y-2 p-4" aria-labelledby="h-restart">
          <h2 id="h-restart" className="h3">{t("restartTitle", { n: h.restart.length })}</h2>
          {h.restart.length === 0 ? (
            <p className="text-sm text-muted">{t("restartNone")}</p>
          ) : (
            <>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {h.restart.map((r) => (
                  <li key={r.key}><Link href={`/admin?tab=settings&setting=${r.key}`} className="hover:underline">{ts(`group.${r.group}`)} › {r.label ? (zh ? r.label.zh : r.label.en) : r.key}</Link></li>
                ))}
              </ul>
              <p className="text-xs text-muted">{t("restartHow")}</p>
              <code className="inline-block rounded-lg bg-[#0b1528] px-2.5 py-1.5 font-mono text-xs text-[#d8f3ea]">pm2 restart sinobee</code>
            </>
          )}
        </section>
      </div>

      <section className="card space-y-3 p-4" aria-labelledby="h-svc">
        <h2 id="h-svc" className="h3">{t("services")}</h2>
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
          {h.services.map((s) => (
            <Link key={s.id} href={s.href} className="flex flex-col gap-1 rounded-xl border border-line p-3 hover:border-accent" data-service={s.id}>
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{s.name || t(`svcName.${s.id}`)}</span>
                <span className={`badge ${PILL[s.level]}`} title={state(s.level)}>{MARK[s.level]} {state(s.level)}</span>
              </span>
              <span className="text-xs text-muted">{t(`line.${s.line.key}`, s.line.values ?? {})}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
