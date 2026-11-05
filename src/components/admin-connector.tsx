"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Action, DangerConfirm, Select } from "./settings-controls";

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
}

/** Connector › 連線: test the saved key and address (lists the vendor's models) */
export function TestConnection({ vendor }: { vendor: string }) {
  const t = useTranslations("admin.svc");
  const router = useRouter();
  const [res, setRes] = useState<{ ok: boolean; models?: number; error?: string; at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-3">
      <Action disabled={busy} onClick={async () => {
        setBusy(true);
        setRes(await post("/api/admin/llm/vendors/test", { vendor }));
        setBusy(false);
        router.refresh();
      }}>{busy ? t("testing") : t("test")}</Action>
      {res && (res.ok ? (
        <span className="text-sm text-ok" role="status">● {t("testOk", { n: res.models ?? 0, at: new Date(res.at).toLocaleTimeString() })}</span>
      ) : (
        <span className="text-sm text-err" role="alert">■ {t("testFail", { error: res.error ?? "" })}</span>
      ))}
    </span>
  );
}

/** Connector › 危險區: remove a key after ticking what it does */
export function RemoveKey({ settingKey, consequence, disabled }: { settingKey: string; consequence: string; disabled?: boolean }) {
  const t = useTranslations("admin.svc");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!open) return <Action kind="danger" disabled={disabled} onClick={() => setOpen(true)}>{t("removeKey")}</Action>;
  return (
    <span className="flex w-full flex-col gap-2">
      <DangerConfirm text={t("iUnderstand", { text: consequence })} checked={ok} onChange={setOk} />
      <span className="flex flex-wrap gap-2">
        <Action kind="danger" disabled={!ok || busy} onClick={async () => {
          setBusy(true);
          const r = await post("/api/admin/settings", { changes: [{ key: settingKey, value: "" }], confirmed: [settingKey] });
          setBusy(false);
          if (r.ok) {
            setOpen(false);
            router.refresh();
          } else setErr(r.error ?? Object.values(r.errors ?? {}).map((e) => (e as { zh: string }).zh).join("；"));
        }}>{t("removeKeyNow")}</Action>
        <Action onClick={() => { setOpen(false); setOk(false); }}>{t("cancel")}</Action>
      </span>
      {err && <span className="text-sm text-err" role="alert">{err}</span>}
    </span>
  );
}

/** 服務 → which service (design: 選單方案 3 — a picker instead of a second menu column) */
export function ServicePicker({ current, options, label }: { current: string; options: { value: string; label: string; note?: string }[]; label: string }) {
  const router = useRouter();
  return <Select value={current} options={options} label={label} onChange={(v) => router.push(`/admin?tab=services&id=${v}`)} />;
}
