"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { CopyCode } from "./copy-code";
import { LocalDate } from "./date";

type Tok = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

export function TokenManager({ tokens }: { tokens: Tok[] }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [name, setName] = useState("my laptop");
  const [created, setCreated] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {tokens.map((x) => (
        <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm">
          <span>
            <b>{x.name}</b> <span className="font-mono text-muted">{x.prefix}…</span>
          </span>
          <span className="text-xs text-muted">
            <LocalDate value={x.createdAt} withTime={false} /> {x.lastUsedAt && <>· {t("lastUsed")} <LocalDate value={x.lastUsedAt} /></>}
          </span>
          <button
            className="text-xs text-err"
            onClick={async () => {
              await fetch(`/api/account/tokens?id=${x.id}`, { method: "DELETE" });
              router.refresh();
            }}
          >
            {t("revoke")}
          </button>
        </div>
      ))}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await fetch("/api/account/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
          const j = await r.json();
          if (r.ok) {
            setCreated(j.token);
            router.refresh();
          }
        }}
      >
        <input className="input max-w-xs" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        <button className="btn-ghost">{t("newToken")}</button>
      </form>
      {created && (
        <div className="space-y-2 rounded-xl bg-accent-soft p-4 text-sm">
          <b>{t("tokenOnce")}</b>
          <CopyCode code={`sinobee keys set sinobee-hub ${created}`} />
        </div>
      )}
    </div>
  );
}
