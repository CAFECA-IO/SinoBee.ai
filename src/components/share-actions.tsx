"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { SINOBEE_PORT } from "@/lib/links";
import { confirmDialog } from "./confirm";

export function ShareOwnerActions({ id, visibility, accounts, description = "", thumbnail = null }: { id: string; visibility: string; accounts: string[]; description?: string; thumbnail?: string | null }) {
  const t = useTranslations("share");
  const router = useRouter();
  const [vis, setVis] = useState(visibility);
  const [list, setList] = useState(accounts.join("\n"));
  const [msg, setMsg] = useState("");
  const [desc, setDesc] = useState(description);
  const save = async () => {
    setMsg("");
    const r = await fetch(`/api/v1/shares/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: vis, description: desc.trim() || null, ...(vis === "LOGIN" ? { accounts: list.split(/[\s,]+/).filter(Boolean) } : {}) }),
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
      <div className="grid gap-3 sm:grid-cols-[240px_1fr]">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={t("thumbnail")} className="aspect-[1200/630] w-full rounded-xl border border-line object-cover" />
        ) : (
          <div className="grid aspect-[1200/630] place-items-center rounded-xl border border-dashed border-line text-xs text-muted">{t("noThumbnail")}</div>
        )}
        <label className="block">
          {t("description")}
          <textarea className="input mt-1 h-24" maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <span className="text-xs text-muted">{vis === "LOGIN" ? t("previewHidden") : t("previewHelp")}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={save}>{t("save")}</button>
        <button
          className="btn-danger"
          onClick={async () => {
            if (!(await confirmDialog(t("confirmRevoke"), { danger: true }))) return;
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

export function ShareReport({ id, targetType = "share" }: { id: string; targetType?: "share" | "tool" }) {
  const t = useTranslations("share");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <p className="text-center text-xs text-muted">{t("reported")}</p>;
  return (
    <div className="text-center">
      {!open ? (
        <button className="text-xs text-muted underline" onClick={() => setOpen(true)}>{t(targetType === "tool" ? "reportTool" : "report")}</button>
      ) : (
        <div className="card mx-auto max-w-md space-y-2 p-4 text-left text-sm">
          <textarea className="input h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reportReason")} />
          <button
            className="btn-ghost"
            onClick={async () => {
              const r = await fetch(`/api/reports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetType, targetId: id, reason }) });
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

/** Import this share into the viewer's own SinoBee as a new conversation */
export function ContinueInSinoBee({ url }: { url: string }) {
  const t = useTranslations("share");
  const [port, setPort] = useState(SINOBEE_PORT);
  const [open, setOpen] = useState(false);
  return (
    <section className="card space-y-3 p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="h3">{t("continue")}</h2>
          <p className="text-xs text-muted">{t("continueHelp")}</p>
        </div>
        <a className="btn-primary" href={`http://localhost:${port}/?import=${encodeURIComponent(url)}`} target="_blank" rel="noopener">
          {t("continueBtn")}
        </a>
      </div>
      <button className="text-xs text-muted underline" onClick={() => setOpen(!open)}>{t("continueMore")}</button>
      {open && (
        <div className="space-y-2 text-xs">
          <label className="flex items-center gap-2">
            {t("port")} <input className="input w-24" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))} />
          </label>
          <pre className="codeblock whitespace-pre-wrap">sinobee share import {url}</pre>
        </div>
      )}
    </section>
  );
}
