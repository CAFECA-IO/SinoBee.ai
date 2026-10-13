"use client";

import { useTranslations } from "next-intl";
import { useCafeca } from "./cafeca-provider";

/** Shows relay QR while waiting for wallet confirmation + error with re-login hint */
export function PayStatus({ busy, error, pendingLink }: { busy: boolean; error: { code: string; message: string } | null; pendingLink: string | null }) {
  const t = useTranslations("pay");
  const { transport, setTransport, logout } = useCafeca();
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-muted">
        {t("transport")}
        <select className="input !w-auto !py-1 text-xs" value={transport} onChange={(e) => setTransport(e.target.value as "popup" | "relay")}>
          <option value="popup">{t("popup")}</option>
          <option value="relay">{t("relay")}</option>
        </select>
      </label>
      {busy && <p className="text-sm text-muted">{t("waiting")}</p>}
      {pendingLink && (
        <div className="rounded-xl border border-line p-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/auth/qr?d=${encodeURIComponent(pendingLink)}`} alt="QR" className="mx-auto h-48 w-48 rounded-lg bg-white p-2" />
          <p className="mt-2 text-xs text-muted">{t("relayHint")}</p>
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-err-soft p-3 text-sm text-err">
          {error.message}
          {error.code === "NO_CHANNEL" && (
            <button className="ml-2 font-semibold underline" onClick={() => logout().then(() => (location.href = "/login?next=" + encodeURIComponent(location.pathname)))}>
              {t("relogin")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
