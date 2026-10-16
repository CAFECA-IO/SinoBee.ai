"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PayForm, postJson, type Buyer } from "./checkout";

type PlanOpt = { id: string; code: string; name: string; fee: number; l6: string; l168: string; concurrency: number };

/** Pick a plan, fill in the invoice details, go to Oen */
export function SubscribeForm({ plans, initial, buyer, startsLabel }: { plans: PlanOpt[]; initial?: string; buyer?: Partial<Buyer> | null; startsLabel: string }) {
  const t = useTranslations("subscribe");
  const [planId, setPlanId] = useState(plans.find((p) => p.code === initial)?.id ?? plans[0]?.id);
  const plan = plans.find((p) => p.id === planId)!;
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
                  <span className={`text-xs ${on ? "text-accent-ink/80" : "text-muted"}`}>{t("limits", { l6: p.l6, l168: p.l168, n: p.concurrency })}</span>
                </button>
              );
            })}
          </div>
          <p className="text-sm text-muted">{startsLabel}</p>
        </div>
      }
      onPay={async (b) => (await postJson<{ payment: { checkoutUrl: string } }>("/api/subscription", { planId, buyer: b })).payment.checkoutUrl}
    />
  );
}
