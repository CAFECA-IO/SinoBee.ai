"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PayForm, postJson, type Buyer, type CardOpt } from "./checkout";
import { useRouter } from "@/i18n/navigation";

type PlanOpt = { id: string; code: string; name: string; fee: number; mult: number; l6: string; week: string; l168: string; concurrency: number };

/** Pick a plan and a saved card; the card is charged right away */
/** startsLabels: plan id → when that plan would start (now as an upgrade, or after the current period) */
export function SubscribeForm({ plans, initial, buyer, startsLabels, cards, pendingCard = false, test = false }: { plans: PlanOpt[]; initial?: string; buyer?: Partial<Buyer> | null; startsLabels: Record<string, string>; cards: CardOpt[]; pendingCard?: boolean; test?: boolean }) {
  const t = useTranslations("subscribe");
  const router = useRouter();
  const [planId, setPlanId] = useState(plans.find((p) => p.code === initial)?.id ?? plans[0]?.id);
  const plan = plans.find((p) => p.id === planId)!;
  // automatic renewal: off unless the buyer ticks it
  const [renew, setRenew] = useState(false);
  // radiogroup keyboard: arrow keys move the selection (and focus) to the previous / next plan
  const onArrow = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = plans[(plans.findIndex((p) => p.id === planId) + step + plans.length) % plans.length];
    setPlanId(next.id);
    (e.currentTarget.querySelector(`[data-plan="${next.code}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <PayForm
      buyer={buyer}
      cards={cards}
      pendingCard={pendingCard}
      test={test}
      returnTo={`/subscribe${initial ? `?plan=${initial}` : ""}`}
      label={t("pay", { fee: plan.fee.toLocaleString("en-US") })}
      extra={
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("plan")} onKeyDown={onArrow}>
            {plans.map((p) => {
              const on = p.id === planId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  data-plan={p.code}
                  onClick={() => setPlanId(p.id)}
                  className={`plan-pick flex flex-col gap-1 rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                    on ? "border-accent bg-accent text-accent-ink shadow-lg shadow-[color-mix(in_srgb,var(--accent)_25%,transparent)]" : "border-line bg-panel text-ink hover:border-accent"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <b>{p.name}</b>
                    <span className="ml-auto font-bold">NT${p.fee.toLocaleString("en-US")}</span>
                  </span>
                  <span className="text-sm font-semibold" data-usage>{t("usage")}</span>
                  <span className={`text-xs ${on ? "text-accent-ink/80" : "text-muted"}`}>{t("limits", { l6: p.l6, week: p.week, l168: p.l168, n: p.concurrency })}</span>
                </button>
              );
            })}
          </div>
          <p className="text-sm text-muted" data-starts>{startsLabels[planId]}</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={renew} onChange={(e) => setRenew(e.target.checked)} data-auto-renew />
            <span>
              {t("autoRenew")}
              <span className="block text-xs text-muted">{t("autoRenewNote", { fee: plan.fee.toLocaleString("en-US") })}</span>
            </span>
          </label>
        </div>
      }
      onPay={async (b, cardId) => {
        await postJson("/api/subscription", { planId, buyer: b, cardId, autoRenew: renew });
        router.push("/account#subscription");
        router.refresh();
      }}
    />
  );
}
