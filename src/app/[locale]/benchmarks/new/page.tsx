import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { TaskForm } from "@/components/task-form";
import { modelsForClient, pricingForClient } from "@/lib/public-config";
import { skillOption } from "@/lib/skill-option";
import { EVAL_METHODS } from "@/lib/tasks/service";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "bench" });
  return { title: t("newTitle") };
}

export default async function NewEvaluationPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ skill?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await currentUser();
  const sp = await searchParams;
  if (!me) redirect({ href: `/login?next=${encodeURIComponent("/benchmarks/new" + (sp.skill ? `?skill=${sp.skill}` : ""))}`, locale });
  const t = await getTranslations("bench");
  const skill = await skillOption(sp.skill);
  return (
    <div className="container-x py-12">
      <h1 className="h1">{t("newTitle")}</h1>
      <p className="mt-2 max-w-3xl text-muted">{t("newLead")}</p>
      <div className="mt-10">
        <TaskForm kind="EVALUATION" models={await modelsForClient()} pricing={pricingForClient()} skill={skill} evalMethods={EVAL_METHODS} />
      </div>
    </div>
  );
}
