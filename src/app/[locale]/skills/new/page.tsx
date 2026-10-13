import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { SkillUpload } from "@/components/skill-upload";
import { PublisherForm } from "@/components/publisher-form";
import { CopyCode } from "@/components/copy-code";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "submit" });
  return { title: t("title") };
}

export default async function NewSkillPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("submit");
  const me = await currentUser();
  if (!me) redirect({ href: "/login?next=/skills/new", locale });
  return (
    <div className="container-x grid gap-10 py-12 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <h1 className="h1">{t("title")}</h1>
        <p className="text-muted">{t("lead")}</p>
        {!me!.publisher ? (
          <div className="card p-6">
            <h2 className="h3">{t("publisherFirst")}</h2>
            <p className="mt-1 text-sm text-muted">{t("publisherHelp")}</p>
            <div className="mt-4">
              <PublisherForm current={null} />
            </div>
          </div>
        ) : (
          <SkillUpload publisher={me!.publisher} />
        )}
      </div>
      <aside className="space-y-4">
        <div className="card p-5 text-sm">
          <h2 className="font-semibold">{t("formatTitle")}</h2>
          <p className="mt-2 text-muted">{t("formatBody")}</p>
          <div className="mt-3">
            <CopyCode
              code={`---
name: my-skill
description: What it does and when to use it (keywords).
license: MIT
metadata:
  version: "1.0.0"
  sinobee-tags: research, pdf
  sinobee-triggers: 報告, report
---
# When to Use
# Procedure
# Gotchas
# Verification`}
            />
          </div>
        </div>
        <div className="card p-5 text-sm">
          <h2 className="font-semibold">{t("cliTitle")}</h2>
          <p className="mt-2 text-muted">
            {t("cliBody")} <Link href="/account" className="text-accent underline">{t("tokenLink")}</Link>
          </p>
          <div className="mt-3">
            <CopyCode code={"sinobee keys set sinobee-hub   # paste sbh_… token\nsinobee skills validate my-skill\nsinobee skills publish my-skill"} />
          </div>
        </div>
        <div className="card p-5 text-sm text-muted">
          <h2 className="font-semibold text-ink">{t("reviewTitle")}</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>{t(`review.${i}`)}</li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
