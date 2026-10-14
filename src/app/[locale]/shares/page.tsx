import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { LocalDate } from "@/components/date";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "share" });
  return { title: t("listTitle") };
}

/** Public shares only (LINK and LOGIN shares are never listed) */
export default async function SharesPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("share");
  const rows = await db.conversationShare.findMany({
    where: { visibility: "PUBLIC", revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { owner: true },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  return (
    <div className="container-x max-w-4xl py-12">
      <h1 className="h1">{t("listTitle")}</h1>
      <p className="mt-2 text-muted">{t("listLead")}</p>
      {rows.length === 0 && <p className="mt-8 text-muted">{t("listEmpty")}</p>}
      <div className="mt-8 space-y-3">
        {rows.map((s) => (
          <Link key={s.id} href={`/s/${s.id}`} className="card block p-4 transition hover:border-accent">
            <div className="font-semibold">{s.title}</div>
            <div className="mt-1 text-xs text-muted">
              {s.owner.handle ? `@${s.owner.handle}` : ""} · {t("msgs", { n: s.messages })} · {t("views", { n: s.views })} · <LocalDate value={s.createdAt} withTime={false} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
