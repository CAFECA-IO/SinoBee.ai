"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useCafeca } from "./cafeca-provider";

export function LoginPanel({ dev, next }: { dev: boolean; next: string }) {
  const t = useTranslations("auth");
  const { ready, me, login, startQr, refresh } = useCafeca();
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (me) router.replace(next);
  }, [me, next, router]);

  const msg = (e: unknown) => {
    const code = (e as { code?: string }).code;
    if (code === "access_denied") return t("errDenied");
    if (code === "popup_blocked") return t("errPopup");
    if (code === "closed") return t("errClosed");
    return (e as Error).message ?? String(e);
  };

  return (
    <div className="mt-6 space-y-3">
      <button
        className="btn w-full bg-gradient-to-r from-[#8e3fa0] via-[#c0428e] to-[#f0a040] !py-3 text-white"
        disabled={!ready || busy}
        onClick={async () => {
          setErr("");
          setBusy(true);
          try {
            await login("popup");
          } catch (e) {
            setErr(msg(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("popup")}
      </button>
      <button className="btn-ghost w-full" disabled={!ready || busy} onClick={() => login("redirect").catch((e) => setErr(msg(e)))}>
        {t("redirect")}
      </button>
      <button
        className="btn-ghost w-full"
        disabled={!ready || busy}
        onClick={async () => {
          setErr("");
          try {
            const { link } = await startQr();
            setQr(link);
          } catch (e) {
            setErr(msg(e));
          }
        }}
      >
        {t("qr")}
      </button>
      {qr && (
        <div className="rounded-xl border border-line p-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/auth/qr?d=${encodeURIComponent(qr)}`} alt="QR" className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />
          <p className="mt-2 text-xs text-muted">{t("qrHint")}</p>
        </div>
      )}
      {err && <p className="rounded-lg bg-err-soft p-3 text-sm text-err">{err}</p>}
      {dev && (
        <button
          className="btn w-full border border-dashed border-warn text-warn"
          onClick={async () => {
            await fetch("/api/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
            await refresh();
          }}
        >
          {t("dev")}
        </button>
      )}
    </div>
  );
}
