"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Toggle } from "./toggle";
import { postJson, type CardOpt } from "./checkout";

/** Automatic renewal on the account page: off by default; on needs a saved card (the last e-invoice buyer is reused) */
export function AutoRenewToggle({ on, cardId, cards, fee }: { on: boolean; cardId: string | null; cards: CardOpt[]; fee: number | null }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [card, setCard] = useState(cardId ?? cards[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async (next: boolean, chosen = card) => {
    setBusy(true);
    setErr("");
    try {
      await postJson("/api/account/auto-renew", next ? { on: true, cardId: chosen } : { on: false });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="space-y-2 rounded-xl bg-panel-2 p-4" data-auto-renew={on ? "on" : "off"}>
      <Toggle checked={on} disabled={busy || (!on && !card)} onChange={(v) => save(v)} label={t("autoRenew")} description={fee ? t("autoRenewNote", { fee: fee.toLocaleString("en-US") }) : undefined} />
      {cards.length === 0 ? (
        <p className="text-xs text-muted">{t("autoRenewNoCard")}</p>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t("autoRenewCard")}</span>
          <select
            className="input !w-auto !py-1.5"
            value={card}
            disabled={busy}
            onChange={(e) => {
              setCard(e.target.value);
              if (on) void save(true, e.target.value);
            }}
          >
            {cards.map((c) => (
              <option key={c.id} value={c.id}>•••• {c.last4 ?? "????"}</option>
            ))}
          </select>
        </label>
      )}
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </div>
  );
}
