import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { mockAllowed, simulatedCard } from "@/lib/payment-mode";
import { MockCardBinding } from "@/components/crowd";

export const dynamic = "force-dynamic";

/** Stand-in for Oen's card binding page: development mock, or the built-in test gateway in test mode */
export default async function MockCard({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ back?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  const card = await db.savedCard.findUnique({ where: { id } });
  if (!me || !card || card.userId !== me.id || card.status !== "pending" || !simulatedCard(card)) notFound();
  if (!mockAllowed() && !card.sandbox) notFound();
  const t = await getTranslations("crowd.mock");
  const raw = (await searchParams).back ?? "/account";
  const back = /^\/[^/\\]/.test(raw) ? raw : "/account";
  return (
    <div className="container-x max-w-xl space-y-6 py-16">
      <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">{t("note")}</p>
      <h1 className="h2">{t("title")}</h1>
      <MockCardBinding cardId={card.id} back={back} />
    </div>
  );
}
