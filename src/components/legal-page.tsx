import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Markdown } from "./markdown";
import { config } from "@/lib/config";
import { LEGAL_DOCS, legalText, type LegalDoc } from "@/lib/legal";

export async function LegalPage({ doc, locale }: { doc: LegalDoc; locale: string }) {
  const t = await getTranslations("legal");
  const text = await legalText(doc, locale);
  return (
    <div className="container-x max-w-3xl space-y-6 py-12">
      <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("nav")}>
        {LEGAL_DOCS.map((d) => (
          <Link key={d} href={`/${d}`} className={d === doc ? "chip !border-accent text-accent" : "chip"} aria-current={d === doc ? "page" : undefined}>
            {t(`${d}.title`)}
          </Link>
        ))}
      </nav>
      <header>
        <h1 className="h1">{t(`${doc}.title`)}</h1>
        <p className="mt-2 text-sm text-muted">{t("effective", { date: config.legal.effective })}</p>
      </header>
      <article className="card p-6 sm:p-8">
        <Markdown>{text}</Markdown>
      </article>
    </div>
  );
}
