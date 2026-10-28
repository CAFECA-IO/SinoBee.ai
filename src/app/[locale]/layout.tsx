import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { config } from "@/lib/config";
import { CafecaProvider } from "@/components/cafeca-provider";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ConfirmHost } from "@/components/confirm";
import { TestRibbon } from "@/components/test-ribbon";
import { DbNotice } from "@/components/db-notice";
import { ClickGuard } from "@/components/click-guard";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  // link-preview picture, 1200×630 (1.91:1, what Facebook, X and LINE crop to)
  const ogImage = { url: `/og/sinobee-${locale === "en" ? "en" : "zh-TW"}.png`, width: 1200, height: 630, alt: t("title") };
  return {
    metadataBase: new URL(config.origin),
    title: { default: t("title"), template: `%s · SinoBee.ai` },
    description: t("description"),
    icons: { icon: "/icon.svg" },
    openGraph: { title: t("title"), description: t("description"), siteName: "SinoBee.ai", images: [ogImage] },
    twitter: { card: "summary_large_image", title: t("title"), description: t("description"), images: [ogImage.url] },
    alternates: { languages: { "zh-TW": "/", en: "/en" } },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  const t = await getTranslations("auth");
  return (
    <html lang={locale === "zh-TW" ? "zh-Hant-TW" : "en"}>
      <body className="min-h-screen">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <CafecaProvider wallet={config.cafecaWallet} statement={t("statement")}>
            <div className="flex min-h-screen flex-col">
              <Header />
              <DbNotice />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <ClickGuard />
            <TestRibbon />
            <ConfirmHost />
          </CafecaProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
