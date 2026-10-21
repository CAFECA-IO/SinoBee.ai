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

/**
 * Permissions of one user, in the user's detail panel: admin role (super admins), disabling the account (any admin,
 * not staff), and transferring super admin behind a typed confirmation.
 */
export function UserPermissions({ userId, account, role, disabled, disabledReason, superAdmin, self }: { userId: string; account: string; role: string; disabled: boolean; disabledReason: string | null; superAdmin: boolean; self: boolean }) {
  const t = useTranslations("admin.us");
  const tu = useTranslations("admin.users");
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const [confirmAcc, setConfirmAcc] = useState("");
  const run = async (url: string, body: unknown) => {
    setErr("");
    setBusy(true);
    const e = await post(url, body);
    setBusy(false);
    if (e) return setErr(e);
    setWhy("");
    router.refresh();
  };
  if (self) return <p className="text-muted">{t("selfNote")}</p>;
  return (
    <div className="space-y-3">
      {superAdmin && role !== "SUPERADMIN" && (
        <div className="flex flex-wrap items-center gap-2">
          {role === "ADMIN" ? (
            <button className="btn-ghost !py-1.5" disabled={busy} onClick={() => run("/api/admin/roles", { userId, role: "USER" })}>{tu("revoke")}</button>
          ) : (
            <button className="btn-ghost !py-1.5" disabled={busy || disabled} onClick={async () => (await confirmDialog(t("grantConfirm"))) && run("/api/admin/roles", { userId, role: "ADMIN" })}>{t("grant")}</button>
          )}
        </div>
      )}
      {!superAdmin && role === "USER" && <p className="text-xs text-muted">{tu("helpAdmin")}</p>}

      {role === "USER" &&
        (disabled ? (
          <div className="space-y-2 rounded-xl border border-err/30 bg-err-soft/30 p-3">
            <p className="text-sm"><span className="font-semibold text-err">{t("disabled")}</span>{disabledReason ? ` · ${disabledReason}` : ""}</p>
            <button className="btn-ghost !py-1.5" disabled={busy} onClick={() => run(`/api/admin/users/${userId}/disable`, { disabled: false })}>{t("enable")}</button>
          </div>
        ) : (
          <details>
            <summary className="cursor-pointer text-sm text-muted hover:text-ink">{t("disable")}…</summary>
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted">{t("disableHelp")}</p>
              <label className="sr-only" htmlFor="disable-why">{t("disableReason")}</label>
              <input id="disable-why" className="input" placeholder={t("disableReason")} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} />
              <button className="btn-danger !py-1.5" disabled={busy || !why.trim()} onClick={async () => (await confirmDialog(t("disableConfirm"), { danger: true })) && run(`/api/admin/users/${userId}/disable`, { disabled: true, reason: why.trim() })}>
                {t("disableGo")}
              </button>
            </div>
          </details>
        ))}

      {superAdmin && role !== "SUPERADMIN" && !disabled && (
        <details>
          <summary className="cursor-pointer text-sm text-muted hover:text-ink">{t("transfer")}…</summary>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted">{t("transferHelp")}</p>
            <input className="input font-mono text-xs" placeholder={account} value={confirmAcc} onChange={(e) => setConfirmAcc(e.target.value)} aria-label={tu("transferConfirm")} />
            <button className="btn-danger !py-1.5" disabled={busy || confirmAcc.trim().toLowerCase() !== account} onClick={() => run("/api/admin/roles/transfer", { userId, confirm: confirmAcc })}>{tu("transferGo")}</button>
          </div>
        </details>
      )}
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </div>
  );
}
