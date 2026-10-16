"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type Buyer = {
  name: string;
  email: string;
  invoice:
    | { invoiceType: "cloud"; carrierType: "" | "3J0002" | "CQ0001"; carrierId?: string }
    | { invoiceType: "company"; buyerIdentifier: string; buyerName?: string };
};

export const emptyBuyer = (b?: Partial<Buyer> | null): Buyer => ({
  name: b?.name ?? "",
  email: b?.email ?? "",
  invoice: b?.invoice ?? { invoiceType: "cloud", carrierType: "" },
});

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? (j.issues ? j.issues.map((i: { message: string }) => i.message).join("; ") : `HTTP ${r.status}`));
  return j as T;
}

/** Buyer and e-invoice fields (Oen issues the e-invoice and emails it) */
export function BuyerFields({ value, onChange }: { value: Buyer; onChange: (b: Buyer) => void }) {
  const t = useTranslations("checkout");
  const inv = value.invoice;
  const kind = inv.invoiceType === "company" ? "company" : inv.carrierType === "3J0002" ? "mobile" : inv.carrierType === "CQ0001" ? "cert" : "member";
  const setKind = (k: string) =>
    onChange({
      ...value,
      invoice: k === "company" ? { invoiceType: "company", buyerIdentifier: "" } : { invoiceType: "cloud", carrierType: k === "mobile" ? "3J0002" : k === "cert" ? "CQ0001" : "", carrierId: "" },
    });
  return (
    <fieldset className="space-y-3">
      <legend className="label">{t("buyer")}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder={t("name")} aria-label={t("name")} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} required maxLength={60} autoComplete="name" />
        <input className="input" type="email" placeholder={t("email")} aria-label={t("email")} value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} required autoComplete="email" />
      </div>
      <label className="block text-sm">
        <span className="text-xs text-muted">{t("invoice")}</span>
        <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="member">{t("inv.member")}</option>
          <option value="mobile">{t("inv.mobile")}</option>
          <option value="cert">{t("inv.cert")}</option>
          <option value="company">{t("inv.company")}</option>
        </select>
      </label>
      {inv.invoiceType === "cloud" && inv.carrierType && (
        <input
          className="input font-mono"
          placeholder={inv.carrierType === "3J0002" ? "/ABC1234" : "AB12345678901234"}
          aria-label={t("carrierId")}
          value={inv.carrierId ?? ""}
          onChange={(e) => onChange({ ...value, invoice: { ...inv, carrierId: e.target.value.toUpperCase() } })}
          required
        />
      )}
      {inv.invoiceType === "company" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input font-mono" inputMode="numeric" maxLength={8} placeholder={t("taxId")} aria-label={t("taxId")} value={inv.buyerIdentifier} onChange={(e) => onChange({ ...value, invoice: { ...inv, buyerIdentifier: e.target.value.replace(/\D/g, "") } })} required />
          <input className="input" placeholder={t("companyName")} aria-label={t("companyName")} value={inv.buyerName ?? ""} onChange={(e) => onChange({ ...value, invoice: { ...inv, buyerName: e.target.value } })} />
        </div>
      )}
    </fieldset>
  );
}

/** Required consent to the terms, refund policy and privacy policy */
export function AgreeTerms() {
  const t = useTranslations("checkout");
  return (
    <label className="flex items-start gap-2 text-xs text-muted">
      <input type="checkbox" role="switch" className="mt-0.5" required name="agree" />
      <span>
        {t.rich("agree", {
          terms: (c) => <Link href="/terms" className="text-accent underline" target="_blank">{c}</Link>,
          refunds: (c) => <Link href="/refunds" className="text-accent underline" target="_blank">{c}</Link>,
          privacy: (c) => <Link href="/privacy" className="text-accent underline" target="_blank">{c}</Link>,
        })}
      </span>
    </label>
  );
}

/** Submit → server creates the payment → browser goes to the Oen checkout page */
export function useCheckout() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go(create: () => Promise<string | null | undefined>) {
    setErr("");
    setBusy(true);
    try {
      const url = await create();
      if (url) {
        window.location.href = url;
        return;
      }
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  return { go, busy, err };
}

/** A standalone pay form: buyer fields + consent + button (subscriptions, top-ups) */
export function PayForm({ buyer: initial, label, extra, onPay }: { buyer?: Partial<Buyer> | null; label: string; extra?: React.ReactNode; onPay: (b: Buyer) => Promise<string | null | undefined> }) {
  const t = useTranslations("checkout");
  const [buyer, setBuyer] = useState(() => emptyBuyer(initial));
  const { go, busy, err } = useCheckout();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void go(() => onPay(buyer));
      }}
    >
      {extra}
      <BuyerFields value={buyer} onChange={setBuyer} />
      <AgreeTerms />
      <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? t("redirecting") : label}</button>
      <p className="text-xs text-muted">{t("oenNote")}</p>
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </form>
  );
}
