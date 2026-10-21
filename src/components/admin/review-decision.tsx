"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { confirmDialog } from "@/components/confirm";

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return (j.error === "invalid_request" ? j.issues?.[0]?.message : j.error) ?? `HTTP ${r.status}`;
}

const MIN_REASON = 4;

/**
 * The decision bar of the review page. Pending: approve (flagged versions need "I checked the findings") or send
 * back with a reason the publisher receives, then move on to the next one. Approved: revoke, with a reason, behind
 * "more".
 */
export function ReviewDecision({ kind, versionId, status, findings, nextHref }: { kind: "skill" | "tool"; versionId: string; status: string; findings: number; nextHref: string }) {
  const t = useTranslations("admin.rv");
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (decision: "approve" | "reject" | "revoke") => {
    setErr("");
    setBusy(true);
    const e =
      kind === "skill"
        ? await post("/api/admin/review", { versionId, decision, note: note.trim() || undefined, acknowledged: ack })
        : await post("/api/admin/tools", { versionId, approve: decision === "approve", note: note.trim() || undefined, acknowledged: ack });
    setBusy(false);
    if (e) return setErr(e);
    setNote("");
    setAck(false);
    // the next one in the queue (dynamic page: the push fetches fresh data); same URL → just refresh
    if (`${window.location.pathname}${window.location.search}`.endsWith(nextHref)) router.refresh();
    else router.push(nextHref);
  };

  if (status === "APPROVED") {
    if (kind === "tool") return null;
    return (
      <details className="group">
        <summary className="cursor-pointer text-sm text-muted hover:text-ink">{t("more")}</summary>
        <div className="mt-3 space-y-2 rounded-xl border border-err/30 bg-err-soft/30 p-3">
          <p className="text-sm">{t("revokeHelp")}</p>
          <label className="block text-sm font-medium" htmlFor="revoke-why">{t("revokeReason")}</label>
          <textarea id="revoke-why" className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          <button
            className="btn-danger"
            disabled={busy || note.trim().length < MIN_REASON}
            onClick={async () => (await confirmDialog(t("revokeConfirm"), { danger: true })) && submit("revoke")}
          >
            {t("revoke")}
          </button>
          {err && <p className="text-sm text-err" role="alert">{err}</p>}
        </div>
      </details>
    );
  }
  if (status !== "PENDING_REVIEW") return null;

  const approve = mode === "approve";
  const blocked = approve ? findings > 0 && !ack : note.trim().length < MIN_REASON;
  return (
    <div className="space-y-3" data-decision={mode}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">{t("decide")}</span>
        <div className="inline-flex overflow-hidden rounded-xl border border-line" role="radiogroup" aria-label={t("decide")}>
          <button type="button" role="radio" aria-checked={approve} onClick={() => setMode("approve")} className={`px-4 py-2 text-sm font-semibold ${approve ? "bg-ink text-bg" : "bg-panel text-muted hover:text-ink"}`}>{t("approve")}</button>
          <button type="button" role="radio" aria-checked={!approve} onClick={() => setMode("reject")} className={`px-4 py-2 text-sm font-semibold ${!approve ? "bg-ink text-bg" : "bg-panel text-muted hover:text-ink"}`}>{t("reject")}</button>
        </div>
      </div>
      {approve ? (
        <>
          {findings > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>{t("ack", { n: findings })}</span>
            </label>
          )}
          <input className="input" placeholder={t("noteOptional")} aria-label={t("noteOptional")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </>
      ) : (
        <>
          <label className="block text-sm font-medium" htmlFor="reject-why">{t("rejectReason")}</label>
          <textarea id="reject-why" className="input min-h-20" placeholder={t("rejectPlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className={approve ? "btn-primary" : "btn-danger"} disabled={busy || blocked} onClick={() => submit(approve ? "approve" : "reject")}>
          {busy ? t("saving") : approve ? t("approveGo") : t("rejectGo")}
        </button>
        <span className="text-xs text-muted">{t("thenNext")}</span>
        {err && <span className="text-sm text-err" role="alert">{err}</span>}
      </div>
    </div>
  );
}
