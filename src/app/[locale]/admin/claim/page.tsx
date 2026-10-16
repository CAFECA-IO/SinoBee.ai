import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { ownerState } from "@/lib/roles";
import { ClaimForm } from "@/components/admin-settings";

export const dynamic = "force-dynamic";

/** One-time owner claim (only while the site has no SUPERADMIN and OWNER_ACCOUNT is not set) */
export default async function ClaimPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const state = await ownerState();
  if (state.bootstrapped) notFound();
  const me = await currentUser();
  if (!me) redirect({ href: "/login?next=/admin/claim", locale });
  const t = await getTranslations("admin.claim");
  return (
    <div className="container-x max-w-2xl space-y-6 py-12">
      <h1 className="h1">{t("title")}</h1>
      {state.mode === "owner-account" ? (
        <p className="text-muted">{t("ownerAccount")}</p>
      ) : (
        <>
          <p className="text-muted">{t("help")}</p>
          <ClaimForm />
        </>
      )}
    </div>
  );
}
