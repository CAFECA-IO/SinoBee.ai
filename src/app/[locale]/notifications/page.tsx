import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import { LocalDate } from "@/components/date";
import { MarkAllRead } from "@/components/mark-read";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me) redirect({ href: "/login?next=/notifications", locale });
  const t = await getTranslations("notifications");
  const rows = await db.notification.findMany({ where: { userId: me!.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="container-x max-w-3xl py-12">
      <div className="flex items-center justify-between">
        <h1 className="h1">{t("title")}</h1>
        {rows.some((r) => !r.readAt) && <MarkAllRead />}
      </div>
      <p className="mt-2 text-sm text-muted">{t("lead")}</p>
      <div className="card mt-6 divide-y divide-line">
        {rows.length === 0 && <p className="p-8 text-center text-muted">{t("empty")}</p>}
        {rows.map((n) => {
          const inner = (
            <>
              <div className="flex items-center gap-2">
                {!n.readAt && <span className="h-2 w-2 rounded-full bg-accent" />}
                <span className="font-medium">{n.title}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{n.body}</p>
              <div className="mt-1 flex gap-3 text-xs text-muted">
                <LocalDate value={n.createdAt} />
                {n.cafecaDeliveredAt && <span className="text-ok">✓ CAFECA</span>}
              </div>
            </>
          );
          return n.link ? (
            <Link key={n.id} href={n.link} className="block p-4 hover:bg-panel-2">
              {inner}
            </Link>
          ) : (
            <div key={n.id} className="p-4">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
