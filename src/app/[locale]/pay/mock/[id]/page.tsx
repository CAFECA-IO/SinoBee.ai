import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { currentUser } from "@/lib/auth";
import { MockPay } from "@/components/payment-watch";

export const dynamic = "force-dynamic";

/** Development stand-in for the Oen checkout page (PAYMENT_MODE=mock; 404 in production) */
export default async function MockCheckout({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (config.payments.mode !== "mock" || process.env.NODE_ENV === "production") notFound();
  const me = await currentUser();
  const pay = await db.payment.findUnique({ where: { id } });
  if (!me || !pay || pay.userId !== me.id || pay.status !== "PENDING") notFound();
  return (
    <div className="container-x max-w-xl space-y-6 py-16">
      <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">Development mock checkout — no money moves (PAYMENT_MODE=mock).</p>
      <h1 className="h2">NT${pay.amountTwd?.toLocaleString("en-US")}</h1>
      <p className="text-sm text-muted">{pay.purpose} · {pay.id}</p>
      <MockPay id={pay.id} />
    </div>
  );
}
