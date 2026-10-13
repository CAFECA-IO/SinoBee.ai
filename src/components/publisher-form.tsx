"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function PublisherForm({ current }: { current: string | null }) {
  const t = useTranslations("account");
  const [v, setV] = useState(current ?? "");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const router = useRouter();
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        setOk(false);
        const r = await fetch("/api/account/publisher", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publisher: v }) });
        if (!r.ok) return setErr((await r.json()).error);
        setOk(true);
        router.refresh();
      }}
    >
      <input className="input max-w-xs font-mono" value={v} onChange={(e) => setV(e.target.value.toLowerCase())} placeholder="my-team" pattern="[a-z0-9][a-z0-9-]{1,38}" required />
      <button className="btn-primary">{t("save")}</button>
      {err && <p className="w-full text-sm text-err">{err}</p>}
      {ok && <p className="w-full text-sm text-ok">✓</p>}
    </form>
  );
}
