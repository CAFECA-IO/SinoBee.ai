"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export type SettingItem = {
  key: string;
  group: string;
  provider?: string;
  type: "text" | "url" | "number" | "secret" | "select" | "bool" | "list";
  label: string;
  help?: string;
  options?: string[];
  restart?: boolean;
  generated?: boolean;
  env?: string;
  source: "env" | "db" | "default" | "unset";
  value: string;
  secretSet?: boolean;
  hint?: string;
  derived?: string;
};

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error === "invalid_request" ? (j.issues?.[0]?.message ?? "invalid") : (j.error ?? `HTTP ${r.status}`));
  return j;
}

function Field({ item, canEdit }: { item: SettingItem; canEdit: boolean }) {
  const t = useTranslations("admin.settings");
  const router = useRouter();
  const [value, setValue] = useState(item.type === "secret" ? "" : item.value);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = item.source === "env";
  const disabled = !canEdit || locked || busy;
  const save = async (v: string) => {
    setErr("");
    setOk(false);
    setBusy(true);
    try {
      await post("/api/admin/settings", { key: item.key, value: v });
      setOk(true);
      if (item.type === "secret") setValue("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const changed = item.type === "secret" ? value !== "" : value !== item.value;
  const listSet = new Set(value.split(",").filter(Boolean));

  let input: React.ReactNode;
  if (item.type === "select")
    input = (
      <select className="input" value={value} disabled={disabled} onChange={(e) => setValue(e.target.value)} aria-label={item.label}>
        {item.options!.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  else if (item.type === "bool")
    input = (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value === "1"} disabled={disabled} onChange={(e) => setValue(e.target.checked ? "1" : "0")} aria-label={item.label} /> {t("on")}
      </label>
    );
  else if (item.type === "list" && item.options)
    input = (
      <div className="flex flex-wrap gap-3 text-sm">
        {item.options.map((o) => (
          <label key={o} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              disabled={disabled}
              checked={listSet.has(o)}
              onChange={(e) => {
                const s = new Set(listSet);
                if (e.target.checked) s.add(o);
                else s.delete(o);
                setValue([...s].join(","));
              }}
            />
            {o}
          </label>
        ))}
      </div>
    );
  else
    input = (
      <input
        className={`input ${item.type === "secret" || item.type === "number" ? "font-mono" : ""}`}
        type={item.type === "secret" ? "password" : "text"}
        inputMode={item.type === "number" ? "decimal" : undefined}
        autoComplete="off"
        placeholder={item.type === "secret" ? (item.secretSet ? t("replace") : t("enter")) : item.source === "default" ? item.value : ""}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        aria-label={item.label}
      />
    );

  return (
    <div className="grid gap-2 border-t border-line p-4 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]" data-setting={item.key}>
      <div>
        <div className="font-medium">{item.label}</div>
        {item.help && <div className="mt-0.5 text-xs text-muted">{item.help}</div>}
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
          <span className={`badge ${locked ? "bg-warn-soft text-warn" : item.source === "db" ? "bg-accent-soft text-ok" : "bg-panel-2 text-muted"}`}>
            {locked ? t("source.env", { env: item.env ?? "" }) : t(`source.${item.source}`)}
          </span>
          {item.type === "secret" && item.secretSet && <span className="badge bg-panel-2 text-muted">{item.generated ? t("generated") : t("set", { hint: item.hint ?? "" })}</span>}
          {item.restart && <span className="badge bg-panel-2 text-muted">{t("restart")}</span>}
        </div>
      </div>
      <div className="space-y-1">
        {input}
        {item.derived && <div className="break-all font-mono text-xs text-muted">{item.key === "hub.signingKey" ? t("publicKey") : t("address")}: {item.derived}</div>}
        {err && <div className="text-xs text-err" role="alert">{err}</div>}
        {ok && <div className="text-xs text-ok">✓ {t("saved")}</div>}
      </div>
      <div className="flex items-start gap-2">
        {canEdit && !locked && (
          <>
            <button className="btn-primary !py-1.5" disabled={!changed || busy} onClick={() => save(value)}>{t("save")}</button>
            {item.source === "db" && !item.generated && (
              <button className="btn-ghost !py-1.5" disabled={busy} onClick={() => confirm(t("confirmClear")) && save("")}>{t("clear")}</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function SettingsGroup({ title, items, canEdit, children }: { title: string; items: SettingItem[]; canEdit: boolean; children?: React.ReactNode }) {
  return (
    <section className="card" data-group={items[0]?.group}>
      <h2 className="h3 p-4">{title}</h2>
      {children}
      {items.map((i) => <Field key={i.key} item={i} canEdit={canEdit} />)}
    </section>
  );
}

export function OenCheck() {
  const t = useTranslations("admin.settings");
  const [res, setRes] = useState<{ ok: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        className="btn-ghost !py-1.5"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setRes(await post("/api/admin/settings/check-oen", {}).catch((e) => ({ ok: false, error: (e as Error).message })));
          setBusy(false);
        }}
      >
        {t("check")}
      </button>
      {res && (res.ok ? <span className="text-ok">✓ {t("checkOk")}</span> : <span className="text-err">{res.error}</span>)}
    </span>
  );
}

export function RotateHubKey() {
  const t = useTranslations("admin.settings");
  const router = useRouter();
  return (
    <button
      className="btn-ghost !py-1.5"
      onClick={async () => {
        if (!confirm(t("confirmRotate"))) return;
        await post("/api/admin/settings/rotate-hub", {});
        router.refresh();
      }}
    >
      {t("rotate")}
    </button>
  );
}
