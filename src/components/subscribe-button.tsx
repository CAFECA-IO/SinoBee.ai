"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { usePay, postJson } from "./use-pay";
import { PayStatus } from "./pay-status";
import type { PaymentIntent } from "./cafeca-provider";

export function SubscribeButton({ price, days, extend }: { price: number; days: number; extend: boolean }) {
  const t = useTranslations("account");
  const router = useRouter();
  const { run, busy, error, pendingLink } = usePay();
  return (
    <div className="space-y-3">
      <PayStatus busy={busy} error={error} pendingLink={pendingLink} />
      <button
        className="btn-primary"
        disabled={busy}
        onClick={async () => {
          const ok = await run(async () => (await postJson<{ payment: PaymentIntent }>("/api/subscription", {})).payment, {
            title: t("subPayTitle", { days }),
            detail: `${price} TWDC`,
          });
          if (ok) router.refresh();
        }}
      >
        {extend ? t("extend", { price, days }) : t("subscribe", { price, days })}
      </button>
    </div>
  );
}
