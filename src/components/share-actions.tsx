"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function ShareOwnerActions({ id, visibility, accounts }: { id: string; visibility: string; accounts: string[] }) {
  const t = useTranslations("share");
  const router = useRouter();
  const [vis, setVis] = useState(visibility);
  const [list, setList] = useState(accounts.join("\n"));
  const [msg, setMsg] = useState("");
  const save = async () => {
    setMsg("");
    const r = await fetch(`/api/v1/shares/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: vis, ...(vis === "LOGIN" ? { accounts: list.split(/[\s,]+/).filter(Boolean) } : {}) }),
    });
    setMsg(r.ok ? t("saved") : (await r.json().catch(() => ({}))).error ?? r.statusText);
    if (r.ok) router.refresh();
  };
  return (
    <section className="card space-y-3 p-5 text-sm">
      <h2 className="h3">{t("manage")}</h2>
      <div className="flex flex-wrap gap-2">
        {(["LINK", "LOGIN", "PUBLIC"] as const).map((v) => (
          <button key={v} className={vis === v ? "btn-primary" : "btn-ghost"} onClick={() => setVis(v)}>{t(`vis.${v}`)}</button>
        ))}
      </div>
      <p className="text-xs text-muted">{t(`visHelp.${vis}`)}</p>
      {vis === "LOGIN" && (
        <label className="block">
          {t("accounts")}
          <textarea className="input mt-1 h-24 font-mono text-xs" value={list} onChange={(e) => setList(e.target.value)} placeholder={"0x1234…abcd\n@handle"} />
          <span className="text-xs text-muted">{t("accountsHelp")}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={save}>{t("save")}</button>
        <button
          className="btn-danger"
          onClick={async () => {
            if (!confirm(t("confirmRevoke"))) return;
            const r = await fetch(`/api/v1/shares/${id}`, { method: "DELETE" });
            if (r.ok) router.refresh();
          }}
        >
          {t("revoke")}
        </button>
        {msg && <span className="text-xs">{msg}</span>}
      </div>
    </section>
  );
}

export function ShareReport({ id }: { id: string }) {
  const t = useTranslations("share");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <p className="text-center text-xs text-muted">{t("reported")}</p>;
  return (
    <div className="text-center">
      {!open ? (
        <button className="text-xs text-muted underline" onClick={() => setOpen(true)}>{t("report")}</button>
      ) : (
        <div className="card mx-auto max-w-md space-y-2 p-4 text-left text-sm">
          <textarea className="input h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reportReason")} />
          <button
            className="btn-ghost"
            onClick={async () => {
              const r = await fetch(`/api/shares/${id}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
              if (r.ok) setDone(true);
            }}
          >
            {t("send")}
          </button>
        </div>
      )}
    </div>
  );
}
