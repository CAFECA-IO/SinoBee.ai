"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PayError, useCafeca, type PaymentIntent } from "./cafeca-provider";

/** Create a payment intent on the server, pay it through CAFECA, confirm it. */
export function usePay() {
  const t = useTranslations("pay");
  const { pay, pendingLink } = useCafeca();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  async function run(create: () => Promise<PaymentIntent>, desc: { title: string; detail?: string }) {
    setBusy(true);
    setError(null);
    try {
      const p = await create();
      await pay(p, desc);
      return true;
    } catch (e) {
      if (e instanceof PayError)
        setError({ code: e.code, message: e.code === "NO_CHANNEL" ? t("noChannel") : e.code === "REJECTED" ? t("rejected") : e.message });
      else setError({ code: "ERROR", message: (e as Error).message ?? String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, pendingLink };
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? (j.issues ? j.issues.map((i: { message: string }) => i.message).join("; ") : `HTTP ${r.status}`));
  return j as T;
}
