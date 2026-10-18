"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { CardBrand } from "@/lib/card-brand";
import { CardBrandMark } from "./card-brand";
import { Icon } from "./icon";

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
/**
 * The consent checkbox used wherever someone must read and agree to terms: an animated mark (a check when ticked,
 * a shaking cross when the form is submitted without it) that settles back to the empty box. The native input stays
 * in the form (name, required, keyboard, screen readers).
 */
export function AgreeCheck({ name = "agree", children }: { name?: string; children: React.ReactNode }) {
  const [mood, setMood] = useState<"idle" | "agree" | "disagree">("idle");
  const [beat, setBeat] = useState(0); // restarts the disagree animation on repeated invalid submits
  useEffect(() => {
    if (mood !== "disagree") return;
    const id = setTimeout(() => setMood("idle"), 1400);
    return () => clearTimeout(id);
  }, [mood, beat]);
  const disagree = () => {
    setMood("disagree");
    setBeat((b) => b + 1);
  };
  return (
    <label className="agree flex items-start gap-2.5 text-xs text-muted" data-mood={mood}>
      <input
        type="checkbox"
        className="checkbox-plain agree-input"
        required
        name={name}
        onChange={(e) => (e.target.checked ? setMood("agree") : disagree())}
        onInvalid={disagree}
      />
      <svg key={beat} className="agree-mark" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect className="agree-box" x="2" y="2" width="20" height="20" rx="6" />
        <circle className="agree-fill" cx="12" cy="12" r="10" />
        <path className="agree-check" d="M7 12.5l3.2 3.2L17.2 8.6" pathLength={1} />
        <path className="agree-x" d="M8 8l8 8M16 8l-8 8" pathLength={1} />
      </svg>
      <span className="pt-0.5">{children}</span>
    </label>
  );
}

/** Consent to the Terms, the Refund Policy and the Privacy Policy before paying */
export function AgreeTerms() {
  const t = useTranslations("checkout");
  return (
    <AgreeCheck>
      {t.rich("agree", {
        terms: (c) => <Link href="/terms" className="text-accent underline" target="_blank">{c}</Link>,
        refunds: (c) => <Link href="/refunds" className="text-accent underline" target="_blank">{c}</Link>,
        privacy: (c) => <Link href="/privacy" className="text-accent underline" target="_blank">{c}</Link>,
      })}
    </AgreeCheck>
  );
}

export type CardOpt = { id: string; last4: string | null; brand?: CardBrand | null };

/** Platform points shown first in the payment methods: they always pay first, the card only the rest */
export type PointsOpt = { balance: number; used: number };

/**
 * Payment method: platform points first (when given: they always pay first), then the saved cards; or bind a new one
 * with Oen (3-D Secure). After binding, Oen confirms the card in the background: while a binding is pending the list
 * refreshes itself until the card shows up.
 */
export function CardPicker({
  cards,
  value,
  onChange,
  pending = false,
  returnTo,
  email,
  test = false,
  points,
  inactive = false,
  extra,
}: {
  cards: CardOpt[];
  value: string;
  onChange: (id: string) => void;
  pending?: boolean;
  returnTo: string;
  email?: string;
  test?: boolean;
  points?: PointsOpt;
  /** another method (e.g. subscription quota) is chosen: no card is highlighted */
  inactive?: boolean;
  /** more methods after the cards (e.g. subscription quota), rendered as tiles too */
  extra?: React.ReactNode;
}) {
  const t = useTranslations("checkout");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [pending, router]);
  useEffect(() => {
    if (!cards.some((c) => c.id === value) && cards[0]) onChange(cards[0].id);
  }, [cards, value, onChange]);
  return (
    <fieldset className="space-y-2">
      <legend className="label">{t("card")}</legend>
      {test && <p className="text-xs text-warn">{t("testCards")}</p>}
      {points && (
        <div className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${points.used > 0 ? "border-accent bg-accent-soft" : "border-line opacity-70"}`}>
          <span className="grid h-6 w-[38px] flex-none place-items-center rounded-md border border-line bg-white text-accent" aria-hidden="true">
            <Icon name="coin" className="h-4 w-4" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block font-semibold">{t("points")}</span>
            <span className="block text-xs text-muted">{t("pointsBalance", { n: points.balance.toLocaleString() })}</span>
          </span>
          <span className="ml-auto whitespace-nowrap font-mono text-sm font-bold text-accent">{points.used > 0 ? t("pointsUsed", { n: points.used.toLocaleString() }) : "—"}</span>
        </div>
      )}
      {cards.length === 0 && !pending && <p className="text-sm text-muted">{t("noCard")}</p>}
      {cards.length > 0 && (
        <div
          role="radiogroup"
          aria-label={t("card")}
          className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]"
          onKeyDown={(e) => {
            const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            const i = cards.findIndex((c) => c.id === value);
            const next = cards[(i + dir + cards.length) % cards.length];
            onChange(next.id);
            document.getElementById(`card-${next.id}`)?.focus();
          }}
        >
          {cards.map((c) => {
            const on = !inactive && c.id === value;
            return (
              <button
                key={c.id}
                id={`card-${c.id}`}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on || (!cards.some((x) => x.id === value) && c === cards[0]) ? 0 : -1}
                onClick={() => onChange(c.id)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-accent ${on ? "border-accent bg-accent-soft font-semibold" : "border-line hover:border-accent/60"}`}
              >
                <CardBrandMark brand={c.brand} />
                <span className="whitespace-nowrap font-mono tracking-wider">•••• {c.last4 ?? "????"}</span>
              </button>
            );
          })}
        </div>
      )}
      {extra}
      {pending && <p className="text-sm text-muted" aria-live="polite">{t("bindingPending")}</p>}
      <button
        type="button"
        className="btn-ghost !py-2 text-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            const r = await postJson<{ url: string }>("/api/cards", { returnTo, email: email || undefined });
            window.location.href = r.url;
          } catch (e) {
            setErr((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {cards.length ? t("addAnother") : t("bindCard")}
      </button>
      <p className="text-xs text-muted">{t("bindNote")}</p>
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </fieldset>
  );
}

/** Submit → the server charges the chosen saved card; `onPay` resolves when the payment went through */
export function useCheckout() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go(pay: () => Promise<void>) {
    setErr("");
    setBusy(true);
    try {
      await pay();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  return { go, busy, err };
}

/** A standalone pay form: saved card + buyer fields + consent + button (subscriptions, proposal fees) */
export function PayForm({
  buyer: initial,
  cards,
  pendingCard = false,
  returnTo,
  test = false,
  label,
  extra,
  onPay,
}: {
  buyer?: Partial<Buyer> | null;
  cards: CardOpt[];
  pendingCard?: boolean;
  returnTo: string;
  test?: boolean;
  label: string;
  extra?: React.ReactNode;
  onPay: (b: Buyer, cardId: string) => Promise<void>;
}) {
  const t = useTranslations("checkout");
  const [buyer, setBuyer] = useState(() => emptyBuyer(initial));
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const { go, busy, err } = useCheckout();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void go(() => onPay(buyer, cardId));
      }}
    >
      {extra}
      <CardPicker cards={cards} value={cardId} onChange={setCardId} pending={pendingCard} returnTo={returnTo} email={buyer.email} test={test} />
      <BuyerFields value={buyer} onChange={setBuyer} />
      <AgreeTerms />
      <button className="btn-primary w-full !py-3" disabled={busy || !cardId}>{busy ? t("charging") : label}</button>
      <p className="text-xs text-muted">{t("oenNote")}</p>
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </form>
  );
}
