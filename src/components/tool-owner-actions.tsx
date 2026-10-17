"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { confirmDialog } from "./confirm";

export function ToolOwnerActions({ name, visibility }: { name: string; visibility: "PUBLIC" | "PRIVATE" }) {
  const t = useTranslations("tools");
  const router = useRouter();
  const [err, setErr] = useState("");
  const call = async (method: string, body?: object) => {
    setErr("");
    const r = await fetch(`/api/v1/tools/_/${name}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? r.statusText);
    return r.ok;
  };
  return (
    <section className="card space-y-3 p-6">
      <h2 className="h3">{t("manage")}</h2>
      <div className="flex flex-wrap gap-2">
        {visibility === "PRIVATE" ? (
          <button className="btn-ghost" onClick={async () => (await call("PATCH", { visibility: "PUBLIC" })) && router.refresh()}>{t("makePublic")}</button>
        ) : (
          <button className="btn-ghost" onClick={async () => (await call("PATCH", { visibility: "PRIVATE" })) && router.refresh()}>{t("makePrivate")}</button>
        )}
        <button
          className="btn-ghost text-err"
          onClick={async () => {
            if ((await confirmDialog(t("confirmDelete"), { danger: true })) && (await call("DELETE"))) router.push("/account#tools");
          }}
        >
          {t("delete")}
        </button>
      </div>
      <p className="text-xs text-muted">{visibility === "PRIVATE" ? t("publicHelp") : t("privateHelp")}</p>
      {err && <p className="text-sm text-err">{err}</p>}
    </section>
  );
}
