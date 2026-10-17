import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "./logo";
import { AGENT_URL } from "@/lib/links";

export async function Footer() {
  const t = await getTranslations("footer");
  const n = await getTranslations("nav");
  return (
    <footer className="mt-20 border-t border-line">
      <div className="container-x grid gap-8 py-10 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <div className="flex items-center gap-2 font-bold text-accent">
            <Logo className="h-6 w-6" /> SinoBee.ai
          </div>
          <p className="mt-3 max-w-sm text-sm text-muted">{t("tagline")}</p>
        </div>
        <div className="space-y-2 text-sm">
          <div className="font-semibold">{t("product")}</div>
          <a className="block text-muted hover:text-accent" href={AGENT_URL} target="_blank" rel="noopener">{n("tryAgent")}</a>
          <Link className="block text-muted hover:text-accent" href="/download">{n("download")}</Link>
          <Link className="block text-muted hover:text-accent" href="/skills">{n("skills")}</Link>
          <Link className="block text-muted hover:text-accent" href="/tasks">{n("tasks")}</Link>
          <Link className="block text-muted hover:text-accent" href="/benchmarks">{n("benchmarks")}</Link>
        </div>
        <div className="space-y-2 text-sm">
          <div className="font-semibold">{t("resources")}</div>
          <a className="block text-muted hover:text-accent" href="https://github.com/CAFECA-IO/SinoBee" target="_blank" rel="noreferrer">GitHub</a>
          <Link className="block text-muted hover:text-accent" href="/docs/hub-api">{t("hubApi")}</Link>
          <Link className="block text-muted hover:text-accent" href="/pricing">{n("pricing")}</Link>
          <a className="block text-muted hover:text-accent" href="https://cafeca.io" target="_blank" rel="noreferrer">CAFECA</a>
        </div>
      </div>
      <div className="container-x flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-5 text-xs text-muted">
        <span>© 2026 CAFECA · SinoBee is MIT licensed</span>
        <span className="flex-1" />
        <Link className="hover:text-accent" href="/terms">{t("terms")}</Link>
        <Link className="hover:text-accent" href="/privacy">{t("privacy")}</Link>
        <Link className="hover:text-accent" href="/refunds">{t("refunds")}</Link>
        <Link className="hover:text-accent" href="/crowd-terms">{t("crowdTerms")}</Link>
      </div>
    </footer>
  );
}
