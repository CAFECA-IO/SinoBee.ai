"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { PayForm, postJson, type Buyer } from "./checkout";

export function TaskOwnerActions({ taskId, status, minTopUp, minBudget, buyer }: { taskId: string; status: string; minTopUp: number; minBudget: number; title: string; buyer?: Partial<Buyer> | null }) {
  const t = useTranslations("task");
  const router = useRouter();
  const unpaid = status === "AWAITING_PAYMENT";
  const [amount, setAmount] = useState(String(unpaid ? Math.max(minBudget, 100) : Math.max(minTopUp, 50)));
  const [closing, setClosing] = useState(false);
  if (!["AWAITING_PAYMENT", "NEEDS_FUNDING", "RUNNING", "QUEUED"].includes(status)) return null;
  return (
    <div className="card space-y-3 p-5">
      <div className="font-semibold">{unpaid ? t("payBudget") : t("topUp")}</div>
      <PayForm
        buyer={buyer}
        label={unpaid ? t("payNow", { amount }) : t("addFunds", { amount })}
        extra={
          <div className="flex items-center gap-2">
            <input className="input font-mono" type="number" step="1" min={unpaid ? minBudget : minTopUp} value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} required aria-label={t("amount")} />
            <span className="text-sm font-semibold">TWD</span>
          </div>
        }
        onPay={async (b) => (await postJson<{ payment: { checkoutUrl: string } }>(`/api/tasks/${taskId}/topup`, { amount: Number(amount), buyer: b })).payment.checkoutUrl}
      />
      {(status === "NEEDS_FUNDING" || unpaid) && (
        <button
          className="btn-ghost w-full"
          disabled={closing}
          onClick={async () => {
            if (!confirm(status === "NEEDS_FUNDING" ? t("confirmClose") : t("confirmCancel"))) return;
            setClosing(true);
            await fetch(`/api/tasks/${taskId}/close`, { method: "POST" });
            router.refresh();
          }}
        >
          {status === "NEEDS_FUNDING" ? t("close") : t("cancel")}
        </button>
      )}
    </div>
  );
}

export function TaskVote({ taskId, mine }: { taskId: string; mine: number }) {
  const [v, setV] = useState(mine);
  const router = useRouter();
  const vote = async (value: number) => {
    const next = v === value ? 0 : value;
    setV(next);
    await fetch(`/api/tasks/${taskId}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: next }) });
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      <button onClick={() => vote(1)} className={`btn-ghost !px-3 ${v === 1 ? "!border-accent text-accent" : ""}`} aria-label="good">👍</button>
      <button onClick={() => vote(-1)} className={`btn-ghost !px-3 ${v === -1 ? "!border-err text-err" : ""}`} aria-label="bad">👎</button>
    </div>
  );
}

/** Poll the task status and refresh the page when it changes */
export function AutoRefresh({ taskId, status }: { taskId: string; status: string }) {
  const router = useRouter();
  useEffect(() => {
    let last = "";
    const id = setInterval(async () => {
      const j = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (!j) return;
      const sig = `${j.status}|${j.charged}|${j.updatedAt}`;
      if (last && sig !== last) router.refresh();
      last = sig;
      if (j.status !== status && !["QUEUED", "RUNNING", "AWAITING_PAYMENT"].includes(j.status)) router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [taskId, status, router]);
  return null;
}

export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return <span>…</span>;
  const ms = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return <span className="font-mono">{d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`}</span>;
}
