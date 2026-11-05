import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { formatPrice, pricesAt } from "@/lib/models";
import { modelCatalogFromApi } from "@/lib/ai-models";
import { pauses } from "@/lib/llm/pause";
import { VENDORS } from "@/lib/llm/vendors";
import { SETTINGS, SETTING } from "@/lib/settings/registry";
import { settingsForAdmin } from "@/lib/settings/store";
import { LocalDate } from "@/components/date";
import { PageHead, twd } from "@/components/admin/kit";
import { VendorPauseSwitch } from "@/components/admin/model-actions";
import { CopyText, OenCheck, RotateHubKey, SettingsBoard, type SettingItem } from "@/components/admin-site-settings";
import { RemoveKey, ServicePicker, TestConnection } from "@/components/admin-connector";
import { OllamaAdmin } from "@/components/admin-ollama";
import { LocutusAdmin } from "@/components/admin-locutus";
import { siteHealth, type Level } from "./health-data";
import type { AdminParams } from "../page";

const MARK: Record<Level, string> = { ok: "●", warn: "▲", bad: "■", off: "○" };
const PILL: Record<Level, string> = {
  ok: "bg-accent-soft text-ok",
  warn: "bg-[#fff1dc] text-[#7a4300] dark:bg-[#3a2a10] dark:text-[#f4c98a]",
  bad: "bg-err-soft text-err",
  off: "bg-panel-2 text-muted",
};

/** One connector: the settings in its 連線 and 限制 parts; extras are drawn by the page */
type Connector = { id: string; name: string; family: string; conn: string[]; limits?: string[]; vendor?: boolean };

function connectors(): Connector[] {
  const keysOf = (group: string, except: string[] = []) => SETTINGS.filter((d) => d.group === group && !except.includes(d.key) && (!d.provider || d.provider === "oen")).map((d) => d.key);
  return [
    { id: "oen", name: "Oen", family: "payments", conn: keysOf("payments", ["site.testMode", "subscription.autoRenewEnabled"]), limits: ["site.testMode"] },
    ...VENDORS.map((v) => ({ id: v.id, name: v.name, family: "vendors", conn: [`apiKeys.${v.id}`, `llm.base.${v.id}`], limits: ["llm.dailyLimitTwd"], vendor: true })),
    { id: "ollama", name: "Ollama", family: "local", conn: ["llm.base.ollama"] },
    { id: "locutus", name: "Locutus", family: "local", conn: ["locutus.enabled", "locutus.publicUrl", "locutus.hubPort", "locutus.hubSecret"] },
    { id: "storage", name: "", family: "storage", conn: keysOf("storage") },
    { id: "boltchain", name: "Boltchain", family: "storage", conn: keysOf("boltchain") },
    { id: "cafeca", name: "CAFECA", family: "identity", conn: keysOf("cafeca") },
    { id: "hub", name: "", family: "identity", conn: keysOf("hub") },
    { id: "tools", name: "", family: "tools", conn: ["apiKeys.brave", "apiKeys.tavily"] },
  ];
}


/**
 * 服務 (design: 建議組合 / B's connector): every external service in one layout — header with its state, 連線 (its
 * settings as field rows, with a connection test), 提供項目, 限制與參數, 活動, 危險區. The rows are the settings
 * board's, so edits go through the same change set and review.
 */
export async function Services({ sp, superAdmin, locale }: { sp: AdminParams; superAdmin: boolean; locale: string }) {
  const t = await getTranslations("admin.svc");
  const th = await getTranslations("admin.health");
  const ts = await getTranslations("admin.settings");
  const zh = locale.startsWith("zh");
  const all = connectors();
  const health = await siteHealth();
  const stateOf = (id: string): Level => {
    const s = health.services.find((x) => x.id === id);
    if (s) return s.level;
    if (all.find((c) => c.id === id)?.vendor) return config.llm.providers[id]?.key ? "ok" : "off";
    if (id === "ollama" || id === "locutus") return config.llm.providers[id]?.key ? "ok" : "off";
    if (id === "tools") return config.runner.containerEnv.some(([k]) => k === "BRAVE_API_KEY" || k === "TAVILY_API_KEY") ? "ok" : "off";
    return "ok";
  };
  const current = all.find((c) => c.id === sp.id) ?? all.find((c) => stateOf(c.id) === "bad") ?? all[0];
  const nameOf = (c: Connector) => c.name || t(`name.${c.id}`);

  // settings rows, localized like the settings page
  const v = settingsForAdmin();
  const items: SettingItem[] = v.items.map((i) => ({ ...i, label: zh ? i.label.zh : i.label.en, help: i.help ? (zh ? i.help.zh : i.help.en) : undefined, link: i.link ? { url: i.link.url, label: zh ? i.link.label.zh : i.link.label.en } : undefined }));
  const mine = items.filter((i) => current.conn.includes(i.key) || current.limits?.includes(i.key));
  const titles = Object.fromEntries(["payments", "apiKeys", "llm", "storage", "boltchain", "cafeca", "hub", "site", "retention"].map((g) => [g, ts(`group.${g}`)]));

  // 提供項目 and 活動
  const now = new Date();
  const [prices, catalog, paused, activity] = await Promise.all([
    pricesAt(new Date(8.64e15)),
    modelCatalogFromApi(),
    pauses(true),
    db.adminAudit.findMany({ where: { targetId: { in: [...current.conn, ...(current.limits ?? [])] } }, orderBy: { createdAt: "desc" }, take: 8, include: { actor: { select: { handle: true, account: true } } } }),
  ]);
  const models = current.vendor ? prices.filter((m) => m.modelId.startsWith(`${current.id}/`)) : [];
  const offered = models.filter((m) => m.enabled && m.effectiveAt <= now);
  const cat = catalog[current.id];
  const isPaused = !!paused[current.id]?.since;
  const keySetting = current.vendor ? items.find((i) => i.key === `apiKeys.${current.id}`) : undefined;
  const level = stateOf(current.id);
  const line = health.services.find((x) => x.id === current.id)?.line;
  const spend = current.vendor && config.llm.providers[current.id]?.key ? await (await import("@/lib/llm/quota")).providerSpendToday(current.id) : null;

  const extraConn: ReactNode =
    current.id === "oen" ? (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">{ts("webhook")}</span>
        <code className="break-all font-mono text-xs">{`${config.origin}/api/payments/oen/webhook`}</code>
        <CopyText text={`${config.origin}/api/payments/oen/webhook`} />
        <OenCheck />
      </div>
    ) : current.vendor ? (
      <TestConnection vendor={current.id} />
    ) : current.id === "hub" && superAdmin ? (
      <RotateHubKey />
    ) : undefined;

  return (
    <div className="space-y-4">
      <PageHead title={t("title")} sub={t("sub")} />
      {/* which service: a picker and the services that need attention, instead of a second menu column */}
      <div className="card flex flex-wrap items-center gap-3 p-2.5">
        <span className="min-w-[14rem] flex-[1_1_18rem]">
          <ServicePicker current={current.id} label={t("pick")}
            options={all.map((c) => ({ value: c.id, label: `${t(`family.${c.family}`)} › ${nameOf(c)}`, note: `${MARK[stateOf(c.id)]} ${th(`state.${stateOf(c.id)}`)}` }))} />
        </span>
        {all.filter((c) => c.id !== current.id && (stateOf(c.id) === "bad" || stateOf(c.id) === "warn")).map((c) => (
          <Link key={c.id} href={`/admin?tab=services&id=${c.id}`} className={`badge min-h-8 font-semibold ${PILL[stateOf(c.id)]}`}>{MARK[stateOf(c.id)]} {nameOf(c)}</Link>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <main className="card min-w-0 flex-[999_1_560px] overflow-hidden pb-2" data-connector={current.id}>
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#0b1528] px-5 py-4 text-white">
            <h2 className="text-xl font-semibold">{nameOf(current)}</h2>
            <span className={`badge font-semibold ${PILL[level]}`}>{MARK[level]} {th(`state.${level}`)}</span>
            {line && <span className="text-sm text-[#c9d6dc]">{th(`line.${line.key}`, line.values ?? {})}</span>}
            {spend && (
              <span className={`text-sm ${spend.reached ? "font-semibold text-[#ffb4bd]" : "text-[#c9d6dc]"}`} data-spend>
                {spend.limit > 0 ? t("spendCap", { spent: twd(spend.spent), limit: twd(spend.limit) }) : t("spend", { spent: twd(spend.spent) })}
                {spend.reached ? ` · ${t("capReached")}` : ""}
              </span>
            )}
            <span className="flex-1" />
            {current.vendor && models.length > 0 && <span className="rounded-xl bg-white px-2 py-1"><VendorPauseSwitch vendor={current.id} label={nameOf(current)} paused={isPaused} offered={offered.length} /></span>}
          </header>

          <SettingsBoard compact sections={[]} items={mine} canEdit={superAdmin} zh={zh} titles={titles}
            parts={[
              { id: "conn", title: t("conn"), keys: current.conn, extra: extraConn },
              ...(current.limits ? [{ id: "limits", title: t("limits"), keys: current.limits, extra: spend?.fromEnv ? <p className="text-xs text-warn">{t("capFromEnv", { env: spend.fromEnv, limit: twd(spend.limit) })}</p> : undefined }] : []),
            ]} />

          {current.vendor && (
            <section aria-labelledby="part-items-t" className="border-t border-line px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="part-items-t" className="text-[15px] font-semibold text-muted">{t("items")}</h2>
                <span className="text-sm">{t("itemsLine", { listed: cat?.models.length ?? 0, priced: models.length, offered: offered.length })}</span>
                <Link href={`/admin?tab=models#vendor-${current.id}`} className="text-sm font-semibold text-accent hover:underline">{t("manageModels")} →</Link>
              </div>
              {offered.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {offered.map((m) => (
                    <li key={m.modelId} className="rounded-lg border border-line px-2.5 py-1 text-xs"><span className="font-semibold">{m.label}</span> <span className="text-muted">{formatPrice(m.twd.input)} / {formatPrice(m.twd.output)}</span></li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {current.id === "ollama" && <div className="border-t border-line p-4"><OllamaAdmin /></div>}
          {current.id === "locutus" && <div className="border-t border-line"><LocutusAdmin /></div>}

          <section id="activity" aria-labelledby="part-act-t" className="scroll-mt-24 border-t border-line px-5 py-4">
            <h2 id="part-act-t" className="text-[15px] font-semibold text-muted">{t("activity")}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {current.vendor && cat && (
                <li className={cat.error ? "text-err" : ""}><LocalDate value={new Date(cat.at)} /> · {cat.error ? t("syncFail", { error: cat.error }) : t("syncOk", { n: cat.models.length })}</li>
              )}
              {activity.map((a) => {
                const d = (a.detail ?? {}) as { value?: string; secret?: boolean };
                const def = SETTING[a.targetId ?? ""];
                return (
                  <li key={a.id} className="text-muted">
                    <LocalDate value={a.createdAt} /> · {a.actor?.handle ?? a.actor?.account?.slice(0, 10) ?? t("system")} · {def ? (zh ? def.label.zh : def.label.en) : a.targetId} {a.action === "settings.clear" ? t("actCleared") : d.secret ? t("actReplaced") : t("actSet", { v: d.value ?? "" })}
                  </li>
                );
              })}
              {!activity.length && !(current.vendor && cat) && <li className="text-muted">{t("noActivity")}</li>}
            </ul>
          </section>

          <section aria-labelledby="part-danger-t" className="border-t border-err/30 bg-err-soft/20 px-5 py-4">
            <h2 id="part-danger-t" className="text-[15px] font-semibold text-err">{t("danger")}</h2>
            {keySetting && keySetting.secretSet && keySetting.source !== "env" ? (
              <div className="mt-2 flex flex-col gap-2">
                <span className="text-sm">{t("removeKeyLine", { n: offered.length })}</span>
                <RemoveKey settingKey={keySetting.key} consequence={t("removeKeyConsequence", { n: offered.length })} disabled={!superAdmin} />
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted">{t("dangerNote")}</p>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
