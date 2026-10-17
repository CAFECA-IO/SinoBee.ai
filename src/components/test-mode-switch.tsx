"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/** Admin: turn test mode on or off (super admins; others see the state) */
export function TestModeSwitch({ on, canChange }: { on: boolean; canChange: boolean }) {
  const t = useTranslations("test");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <section className={`card flex flex-wrap items-center gap-4 p-5 ${on ? "border-warn" : ""}`} data-test-mode={on ? "on" : "off"}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-semibold">
          {t("switch")}
          <span className={`badge ${on ? "bg-warn-soft text-warn" : "bg-panel-2 text-muted"}`}>{on ? t("on") : t("off")}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{t("help")}</p>
        {err && <p className="mt-1 text-sm text-err" role="alert">{err}</p>}
      </div>
      <input
        type="checkbox"
        role="switch"
        aria-label={t("switch")}
        checked={on}
        disabled={!canChange || busy}
        onChange={async (e) => {
          const next = e.target.checked;
          if (!confirm(next ? t("confirmOn") : t("confirmOff"))) return;
          setBusy(true);
          setErr("");
          const r = await fetch("/api/admin/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "site.testMode", value: next ? "1" : "0" }) });
          if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
          setBusy(false);
          router.refresh();
        }}
      />
    </section>
  );
}
