import { getTranslations } from "next-intl/server";
import { config } from "@/lib/config";
import { Link } from "@/i18n/navigation";
import { settingsForAdmin } from "@/lib/settings/store";
import { settingsHealth } from "@/lib/admin-overview";
import { CopyText, OenCheck, RotateHubKey, SettingsBoard, type SettingItem, type SettingsSection } from "@/components/admin-site-settings";
import { Icon } from "@/components/icon";
import { PageHead } from "@/components/admin/kit";
import type { AdminParams } from "../page";

const GROUPS = ["payments", "apiKeys", "llm", "legal", "cafeca", "pricing", "retention", "storage", "boltchain", "hub", "runner", "security"] as const;

export async function SiteSettings({ superAdmin, locale, sp }: { superAdmin: boolean; locale: string; sp: AdminParams }) {
  const t = await getTranslations("admin.settings");
  const ts = await getTranslations("admin.set");
  const to = await getTranslations("admin.ov");
  const ta = await getTranslations("admin");
  const v = settingsForAdmin();
  const zh = locale.startsWith("zh");
  const items: SettingItem[] = v.items.map((i) => ({ ...i, label: zh ? i.label.zh : i.label.en, help: i.help ? (zh ? i.help.zh : i.help.en) : undefined }));
  const provider = items.find((i) => i.key === "payments.provider")?.value ?? "oen";
  const shown = items.filter((i) => !i.provider || i.provider === provider);
  const webhook = `${config.origin}/api/payments/oen/webhook`;
  const health = settingsHealth();
  const open = health.filter((c) => !c.ok);
  // per group: open go-live checks, plus required fields still empty that no check covers
  const need = (i: SettingItem) => !!i.required && (i.type === "secret" ? !i.secretSet : !i.value);
  const counts: Record<string, number> = {};
  for (const g of GROUPS) {
    const checks = open.filter((c) => c.group === g);
    const covered = new Set(checks.flatMap((c) => c.keys));
    counts[g] = checks.length + shown.filter((i) => i.group === g && need(i) && !covered.has(i.key)).length;
  }
  const sections: SettingsSection[] = GROUPS.map((g) => ({
    id: g,
    title: g === "security" ? ts("security") : t(`group.${g}`),
    description: g === "security" ? ts("securityHelp") : t(`groupHelp.${g}`),
    extra:
      g === "payments" ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel-2/50 px-4 py-3 text-sm">
          <span className="text-muted">{t("webhook")}</span>
          <code className="break-all font-mono text-xs">{webhook}</code>
          <CopyText text={webhook} />
          <span className="flex-1" />
          <OenCheck />
        </div>
      ) : g === "hub" && superAdmin ? (
        <div className="border-t border-line px-4 py-3"><RotateHubKey /></div>
      ) : g === "security" ? (
        <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-sm">
          <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <p className="min-w-0 break-words">{t("keyFile", { file: v.keyFile, fp: v.fingerprint })}</p>
        </div>
      ) : undefined,
  }));
  const initial = (GROUPS as readonly string[]).includes(sp.group ?? "") ? sp.group : (open.find((c) => c.level === "error")?.group ?? open[0]?.group ?? "payments");
  const done = health.length - open.length;

  return (
    <div className="space-y-4">
      <PageHead title={ta("tab.settings")} sub={superAdmin ? undefined : t("readOnly")} />
      {open.length > 0 && (
        <section className="card space-y-3 p-4" aria-labelledby="golive">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="golive" className="h3">{ts("goLive", { n: open.length })}</h2>
            <span className="text-xs text-muted">{ts("goLiveSub", { done, total: health.length, blocking: open.filter((c) => c.level === "error").length })}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={health.length}>
            <div className="h-full bg-accent" style={{ width: `${(done / health.length) * 100}%` }} />
          </div>
          <ol className="flex flex-wrap gap-2">
            {open.map((c, i) => (
              <li key={c.id}>
                <Link href={`/admin?tab=settings&group=${c.group}`} className={`btn-ghost !px-3 !py-1.5 text-xs ${c.level === "error" ? "!border-err/50 !text-err" : ""}`} data-check={c.id}>
                  {i + 1}. {to(`check.${c.id}.title`)}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
      <SettingsBoard key={initial} sections={sections} items={shown} canEdit={superAdmin} initial={initial} counts={counts} />
      <p className="text-xs text-muted">{t("help")}</p>
    </div>
  );
}
