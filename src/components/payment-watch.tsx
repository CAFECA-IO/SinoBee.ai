"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/** While a payment is pending, ask the server (which asks Oen) every 3 s and refresh when it settles */
export function PaymentWatch({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const timer = setInterval(async () => {
      n++;
      const j = await fetch(`/api/payments/${id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if ((j && j.status !== "PENDING") || n > 100) {
        clearInterval(timer);
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [id, router]);
  return null;
}

export function MockPay({ id }: { id: string }) {
  const router = useRouter();
  const act = async (ok: boolean) => {
    await fetch(`/api/payments/${id}/mock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ok }) });
    router.push(`/pay/return/${id}`);
  };
  return (
    <div className="flex gap-3">
      <button className="btn-primary" onClick={() => act(true)}>Pay (simulate success)</button>
      <button className="btn-ghost" onClick={() => act(false)}>Decline (simulate failure)</button>
    </div>
  );
}
