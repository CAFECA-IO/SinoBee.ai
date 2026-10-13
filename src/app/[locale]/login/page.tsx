import { getTranslations, setRequestLocale } from "next-intl/server";
import { devLoginEnabled } from "@/lib/auth";
import { LoginPanel } from "@/components/login-panel";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("title") };
}

export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("auth");
  const next = (await searchParams).next;
  return (
    <div className="container-x flex justify-center py-16">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("lead")}</p>
        <LoginPanel dev={devLoginEnabled()} next={next && next.startsWith("/") && !next.startsWith("//") ? next : "/"} />
        <p className="mt-6 text-xs text-muted">{t("privacy")}</p>
      </div>
    </div>
  );
}
