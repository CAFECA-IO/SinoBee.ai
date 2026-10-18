import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { AgentLauncher } from "@/components/agent-launcher";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "agent" });
  return { title: t("title") };
}

/** 線上使用: sign in, then open the user's own SinoBee (its container starts on first use) */
export default async function AgentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me) redirect({ href: "/login?next=/agent", locale });
  const t = await getTranslations("agent");
  return (
    <div className="container-x flex justify-center py-16">
      <div className="card w-full max-w-md space-y-4 p-8 text-center">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted">{t("lead")}</p>
        <AgentLauncher />
      </div>
    </div>
  );
}
