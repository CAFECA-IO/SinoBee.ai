"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "./icon";
import { fetchSiteStatus, type DbStatus } from "./site-status";

const DISMISS_KEY = "sb_db_notice_dismissed";

/**
 * Shown under the header while the database is unreachable. Visitors get one quiet, dismissible line; admins
 * (signed role hint) get the error code, since when and the connection target. Re-checks every 20 s and disappears
 * on recovery.
 */
export function DbNotice() {
  const t = useTranslations("dbDown");
  const locale = useLocale();
  const [db, setDb] = useState<DbStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
    const check = () =>
      void fetchSiteStatus().then((s) => {
        if (!alive) return;
        const d = s?.db ?? null;
        setDb(d);
        if (d && !d.ok) timer = setTimeout(check, 20_000);
      });
    check();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!db || db.ok) return null;

  if (db.admin) {
    const since = db.since ? new Date(db.since).toLocaleString(locale) : "—";
    return (
      <div role="alert" className="border-b border-warn/30 bg-warn-soft text-warn">
        <div className="container-x flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-sm">
          <Icon name="database" className="mt-0.5 h-4 w-4 flex-none" />
          <div className="min-w-0 flex-1">
            <strong className="font-semibold">{t("adminTitle")}</strong>
            <span className="ml-2">{t("adminBody", { since, code: db.code ?? "unknown" })}</span>
            <div className="mt-0.5 break-all font-mono text-xs opacity-90">{t("adminTarget", { kind: db.kind ?? "", target: db.target ?? "" })}</div>
          </div>
        </div>
      </div>
    );
  }

  if (dismissed) return null;
  return (
    <div role="status" className="border-b border-line bg-panel-2 text-muted">
      <div className="container-x flex items-center gap-3 py-2 text-sm">
        <Icon name="database" className="h-4 w-4 flex-none" />
        <span className="min-w-0 flex-1">{t("userBar")}</span>
        <button
          type="button"
          className="icon-btn !h-8 !w-8"
          aria-label={t("dismiss")}
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* storage unavailable */
            }
          }}
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
