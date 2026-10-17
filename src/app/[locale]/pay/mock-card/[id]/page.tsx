import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { mockAllowed } from "@/lib/payment-mode";
import { MockCardBinding } from "@/components/crowd";

export const dynamic = "force-dynamic";

/** Development stand-in for Oen's card binding page (PAYMENT_MODE=mock; 404 in production) */
export default async function MockCard({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ back?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!mockAllowed()) notFound();
  const me = await currentUser();
  const card = await db.savedCard.findUnique({ where: { id } });
  if (!me || !card || card.userId !== me.id || card.status !== "pending") notFound();
  const t = await getTranslations("crowd.mock");
  const raw = (await searchParams).back ?? "/account";
  const back = /^\/[^/\\]/.test(raw) ? raw : "/account";
  return (
    <div className="container-x max-w-xl space-y-6 py-16">
      <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">Development mock — no card is saved and no money moves (PAYMENT_MODE=mock).</p>
      <h1 className="h2">{t("title")}</h1>
      <MockCardBinding cardId={card.id} back={back} />
    </div>
  );
}
