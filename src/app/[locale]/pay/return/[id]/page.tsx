import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import { syncPayment } from "@/lib/payments";
import { PaymentWatch } from "@/components/payment-watch";

export const dynamic = "force-dynamic";

const ERRORS = ["V0002", "V0003", "T0001", "T0002", "T0003", "T0004", "T0005"];

/**
 * Where Oen sends the browser after checkout (success and failure alike). The redirect proves nothing, so the page
 * asks Oen for the transaction before showing a result.
 */
export default async function PayReturn({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ payment_error?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me) redirect({ href: `/login?next=/pay/return/${id}`, locale });
  let pay = await db.payment.findUnique({ where: { id } });
  if (!pay || pay.userId !== me!.id) notFound();
  if (pay.status === "PENDING") pay = await syncPayment(pay.id).catch(() => pay!);
  const t = await getTranslations("payReturn");
  const err = (await searchParams).payment_error;
  const proposal = pay.purpose === "CROWD_PROPOSAL" && pay.taskId;
  const next = proposal ? `/crowd/${pay.taskId}/edit` : pay.taskId ? `/tasks/${pay.taskId}` : "/account#subscription";
  const state = pay.status === "CONFIRMED" ? "ok" : pay.status === "PENDING" ? (err && err !== "V0003" ? "failed" : "pending") : "failed";
  // a paid proposal fee goes straight back to the proposal, where the model drafts the spec
  if (state === "ok" && proposal) redirect({ href: `${next}?paid=1`, locale });
  return (
    <div className="container-x max-w-xl space-y-6 py-16 text-center" data-state={state}>
      {state === "pending" && <PaymentWatch id={pay.id} />}
      <h1 className="h1">{t(`title.${state}`)}</h1>
      <p className="text-muted">
        {state === "ok" && t(`ok.${pay.purpose}`, { amount: pay.amountTwd ?? 0 })}
        {state === "pending" && (pay.providerStatus === "charging" ? t("charging") : t("pending"))}
        {state === "failed" && (err && ERRORS.includes(err) ? t(`err.${err}`) : t("failed"))}
      </p>
      <div className="flex justify-center gap-3">
        <Link href={next} className="btn-primary">{proposal ? t("toProposal") : pay.taskId ? t("toTask") : t("toAccount")}</Link>
        {state === "failed" && pay.purpose === "SUBSCRIPTION" && <Link href="/subscribe" className="btn-ghost">{t("retry")}</Link>}
      </div>
      <p className="font-mono text-xs text-muted">{pay.transactionHid ?? pay.id}</p>
    </div>
  );
}
