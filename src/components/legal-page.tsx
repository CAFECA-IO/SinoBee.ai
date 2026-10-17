import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Markdown } from "./markdown";
import { BoltchainBadge } from "./boltchain-badge";
import { config } from "@/lib/config";
import { LEGAL_DOCS, legalPath, type LegalDoc } from "@/lib/legal";
import { legalCertificate, snapshotLegal } from "@/lib/legal-versions";

export async function LegalPage({ doc, locale }: { doc: LegalDoc; locale: string }) {
  const t = await getTranslations("legal");
  // the text shown is exactly the recorded (and notarized) version
  const version = await snapshotLegal(doc, locale);
  const cert = await legalCertificate(version.id);
  return (
    <div className="container-x max-w-3xl space-y-6 py-12">
      <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("nav")}>
        {LEGAL_DOCS.map((d) => (
          <Link key={d} href={legalPath(d)} className={d === doc ? "chip !border-accent text-accent" : "chip"} aria-current={d === doc ? "page" : undefined}>
            {t(`${d}.title`)}
          </Link>
        ))}
      </nav>
      <header className="space-y-3">
        <h1 className="h1">{t(`${doc}.title`)}</h1>
        <p className="text-sm text-muted">{t("effective", { date: config.legal.effective })}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {cert.code ? (
            <BoltchainBadge code={cert.code} title={t("notary.title")} />
          ) : (
            <span className="chip">{config.boltchain.enabled ? t("notary.pending") : t("notary.off")}</span>
          )}
          <span className="font-mono">{t("notary.version", { v: version.version, sha: version.sha256.slice(0, 16) + "…" })}</span>
          <a href={`/api/legal/${version.id}`} className="text-accent underline" title={t("notary.verify")}>
            {t("notary.markdown")}
          </a>
        </div>
        {cert.publicFiles && <p className="text-xs text-muted">{cert.code ? t("notary.public") : t("notary.publicPending")}</p>}
      </header>
      <article className="card p-6 sm:p-8">
        <Markdown>{version.markdown}</Markdown>
      </article>
    </div>
  );
}
