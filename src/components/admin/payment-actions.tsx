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

/** Ask Oen about a payment that has not come back */
export function PaymentSync({ id, label }: { id: string; label?: string }) {
  const t = useTranslations("admin.payments");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className="btn-ghost !py-1.5"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr((await post(`/api/admin/payments/${id}/sync`, {})) ?? "");
          setBusy(false);
          router.refresh();
        }}
      >
        {label ?? t("sync")}
      </button>
      {err && <span className="text-xs text-err" role="alert">{err}</span>}
    </span>
  );
}

/** Refund form in the payment's detail panel: amount (up to what can be refunded), a reason for the record */
export function PaymentRefund({ id, max, effect }: { id: string; max: number; effect: string }) {
  const t = useTranslations("admin.pay");
  const router = useRouter();
  const [amount, setAmount] = useState(String(max));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const n = Number(amount);
  const ok = Number.isInteger(n) && n >= 1 && n <= max && reason.trim().length > 0;
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!(await confirmDialog(t("refundConfirm", { amount: n.toLocaleString("en-US") }), { danger: true }))) return;
        setBusy(true);
        setErr("");
        const e2 = await post(`/api/admin/payments/${id}/refund`, { amount: n, reason: reason.trim() });
        setBusy(false);
        if (e2) return setErr(e2);
        router.refresh();
      }}
    >
      <label className="block">
        <span className="mb-1 block text-xs text-muted">{t("amount", { max: max.toLocaleString("en-US") })}</span>
        <input className="input font-mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted">{t("reason")}</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t("reasonPh")} />
      </label>
      <p className="rounded-xl border border-warn/40 bg-warn-soft/50 px-3 py-2 text-xs text-warn">{effect}</p>
      <button className="btn-danger" disabled={busy || !ok}>{t("refundGo", { amount: (Number.isFinite(n) ? n : 0).toLocaleString("en-US") })}</button>
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </form>
  );
}
