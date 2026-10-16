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
  return (
    <PayForm
      buyer={buyer}
      label={t("pay", { fee: plan.fee.toLocaleString("en-US") })}
      extra={
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("plan")}>
            {plans.map((p) => (
              <label key={p.id} data-plan={p.code} className={`card flex cursor-pointer flex-col gap-1 p-4 ${p.id === planId ? "!border-accent ring-1 ring-[var(--accent)]" : ""}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="plan" value={p.id} checked={p.id === planId} onChange={() => setPlanId(p.id)} />
                  <b>{p.name}</b>
                  <span className="ml-auto font-bold">NT${p.fee.toLocaleString("en-US")}</span>
                </span>
                <span className="text-xs text-muted">{t("limits", { l6: p.l6, l168: p.l168, n: p.concurrency })}</span>
              </label>
            ))}
          </div>
          <p className="text-sm text-muted">{startsLabel}</p>
        </div>
      }
      onPay={async (b) => (await postJson<{ payment: { checkoutUrl: string } }>("/api/subscription", { planId, buyer: b })).payment.checkoutUrl}
    />
  );
}
