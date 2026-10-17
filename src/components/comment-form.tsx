"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function CommentForm({ targetType, targetId, parentId, compact, canReference }: { targetType: string; targetId: string; parentId?: string; compact?: boolean; canReference?: boolean }) {
  const t = useTranslations("comments");
  const router = useRouter();
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(!compact);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reference, setReference] = useState(false);
  if (!open)
    return (
      <button className="ml-6 text-xs font-semibold text-accent" onClick={() => setOpen(true)}>
        {t("reply")}
      </button>
    );
  return (
    <form
      className={compact ? "ml-6 space-y-2" : "space-y-2"}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        const r = await fetch("/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetType, targetId, parentId, body, kind: reference ? "reference" : "comment" }) });
        setBusy(false);
        if (!r.ok) return setErr((await r.json().catch(() => ({}))).error ?? "error");
        setBody("");
        setReference(false);
        if (compact) setOpen(false);
        router.refresh();
      }}
    >
      <textarea className="input min-h-20" value={body} onChange={(e) => setBody(e.target.value)} placeholder={parentId ? t("replyPlaceholder") : t("placeholder")} maxLength={5000} required />
      {canReference && !parentId && (
        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" className="mt-1" checked={reference} onChange={(e) => setReference(e.target.checked)} />
          <span>{t("markReference")}</span>
        </label>
      )}
      {err && <p className="text-sm text-err">{err}</p>}
      <button className="btn-primary !py-2" disabled={busy || !body.trim()}>
        {parentId ? t("reply") : t("submit")}
      </button>
    </form>
  );
}

export function DeleteComment({ id }: { id: string }) {
  const t = useTranslations("comments");
  const router = useRouter();
  return (
    <button
      className="text-err/80 hover:text-err"
      onClick={async () => {
        if (!confirm(t("confirmDelete"))) return;
        await fetch(`/api/comments?id=${id}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      {t("delete")}
    </button>
  );
}
