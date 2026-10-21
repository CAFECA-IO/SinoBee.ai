"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return j.error === "invalid_request" ? (j.issues?.[0]?.message ?? "invalid") : (j.error ?? `HTTP ${r.status}`);
}

// ───────────── owner claim ─────────────

export function ClaimForm() {
  const t = useTranslations("admin.claim");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        const e2 = await send("/api/admin/claim", "POST", { code });
        setBusy(false);
        if (e2) return setErr(e2);
        router.push("/admin?tab=users");
        router.refresh();
      }}
    >
      <input className="input max-w-xs font-mono uppercase" placeholder="XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("code")} autoComplete="off" />
      <button className="btn-primary" disabled={busy || code.length < 4}>{t("submit")}</button>
      {err && <span className="text-sm text-err" role="alert">{err}</span>}
    </form>
  );
}
