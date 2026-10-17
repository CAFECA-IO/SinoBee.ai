import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { redirect } from "@/i18n/navigation";
import { CrowdNewForm } from "@/components/crowd";
import { modelsForClient } from "@/lib/public-config";
import { skillOption } from "@/lib/skill-option";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "crowd" });
  return { title: t("newTitle") };
}

export default async function NewCrowdPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ skill?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  if (!me) redirect({ href: "/login?next=/crowd/new", locale });
  const t = await getTranslations("crowd");
  const skill = await skillOption((await searchParams).skill);
  const models = (await modelsForClient()).map(({ id, label, vendor }) => ({ id, label, vendor }));
  return (
    <div className="container-x py-12">
      <h1 className="h1">{t("newTitle")}</h1>
      <p className="mt-2 max-w-3xl text-muted">{t("newLead")}</p>
      <ol className="mt-6 grid gap-3 text-sm sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="card p-4">
            <div className="text-xs font-bold text-accent">0{i + 1}</div>
            <div className="mt-1">{t(`steps.${i}`, { fee: Math.round(config.crowd.proposalFee) })}</div>
          </li>
        ))}
      </ol>
      <div className="mt-10">
        <CrowdNewForm models={models} skill={skill} />
      </div>
    </div>
  );
}
