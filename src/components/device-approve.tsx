"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

type Req = { deviceName: string; platform: string | null; scopes: string[]; createdAt: string };

export function DeviceApprove({ account, initialCode, request }: { account: string; initialCode: string; request: Req | null }) {
  const t = useTranslations("device");
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<"idle" | "busy" | "approved" | "denied">("idle");
  const [err, setErr] = useState("");

  if (state === "approved" || state === "denied")
    return (
      <div className={`rounded-xl p-4 text-sm ${state === "approved" ? "bg-accent-soft" : "border border-line"}`}>
        <b>{state === "approved" ? t("approved") : t("denied")}</b>
        <p className="mt-1 text-muted">{state === "approved" ? t("approvedHelp") : t("deniedHelp")}</p>
      </div>
    );

  if (!request)
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/device?code=${encodeURIComponent(code.trim())}`);
        }}
      >
        {initialCode && <p className="text-sm text-err">{t("notFound")}</p>}
        <label className="block text-sm">
          {t("enterCode")}
          <input className="input mt-1 text-center font-mono text-xl tracking-widest uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" maxLength={9} autoFocus required />
        </label>
        <button className="btn w-full">{t("continue")}</button>
      </form>
    );

  const decide = async (approve: boolean) => {
    setState("busy");
    setErr("");
    const r = await fetch("/api/device/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, approve }) });
    if (r.ok) setState(approve ? "approved" : "denied");
    else {
      setErr((await r.json().catch(() => ({}))).error ?? r.statusText);
      setState("idle");
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-xl border border-line p-4">
        <div className="text-center font-mono text-2xl tracking-widest">{code}</div>
        <p className="mt-2 text-center text-muted">{t("checkCode")}</p>
      </div>
      <div className="grid grid-cols-[120px_1fr] gap-2">
        <span className="text-muted">{t("deviceName")}</span>
        <b>{request.deviceName}</b>
        {request.platform && (
          <>
            <span className="text-muted">{t("platform")}</span>
            <span>{request.platform}</span>
          </>
        )}
        <span className="text-muted">{t("account")}</span>
        <span className="break-all font-mono text-xs">{account}</span>
      </div>
      <div>
        <p className="text-muted">{t("willAllow")}</p>
        <ul className="mt-1 list-disc pl-5">
          {request.scopes.map((s) => (
            <li key={s}>{t(`scope.${s.replace(":", "_")}`)}</li>
          ))}
        </ul>
      </div>
      {err && <p className="text-err">{err}</p>}
      <div className="flex gap-2">
        <button className="btn flex-1" disabled={state === "busy"} onClick={() => decide(true)}>
          {t("approve")}
        </button>
        <button className="btn-ghost flex-1" disabled={state === "busy"} onClick={() => decide(false)}>
          {t("deny")}
        </button>
      </div>
      <p className="text-xs text-muted">{t("warn")}</p>
    </div>
  );
}
