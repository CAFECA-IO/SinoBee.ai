import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { redirect } from "@/i18n/navigation";
import type { Buyer } from "@/components/checkout";
import { CrowdNewForm } from "@/components/crowd";
import { modelsForClient } from "@/lib/public-config";
import { skillOption } from "@/lib/skill-option";
import { checkoutCards } from "@/lib/crowd/cards";
import { EVAL_METHODS } from "@/lib/crowd/rules";
import { feeWaived } from "@/lib/crowd/proposal";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "crowd" });
  return { title: t("newTitle") };
}

/** Step 1 of 3: describe it and pay the proposal fee; the model drafts the spec right after */
export default async function NewCrowdPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ skill?: string; kind?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const me = await currentUser();
  if (!me) redirect({ href: `/login?next=${encodeURIComponent(`/crowd/new${sp.kind || sp.skill ? `?${new URLSearchParams({ ...(sp.kind ? { kind: sp.kind } : {}), ...(sp.skill ? { skill: sp.skill } : {}) })}` : ""}`)}`, locale });
  const t = await getTranslations("crowd");
  const skill = await skillOption(sp.skill);
  const models = (await modelsForClient()).map(({ id, label, vendor }) => ({ id, label, vendor }));
  const fee = Math.round(config.crowd.proposalFee);
  // subscribers start proposals without the fee
  const waived = await feeWaived(me!.id);
  return (
    <div className="container-x py-12">
      <h1 className="h1">{t("newTitle")}</h1>
      <p className="mt-2 max-w-3xl text-muted">{t("newLead")}</p>
      <ol className="mt-6 grid max-w-3xl gap-3 text-sm sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className={`card p-4 ${i === 0 ? "border-accent" : ""}`}>
            <div className="text-xs font-bold text-accent">{i + 1}</div>
            <div className="mt-1">{i === 0 && waived ? t("steps.0waived") : t(`steps.${i}`, { fee })}</div>
          </li>
        ))}
      </ol>
      <div className="mt-8">
        <CrowdNewForm models={models} skill={skill} kind={sp.kind === "evaluation" ? "EVALUATION" : "TASK"} evalMethods={EVAL_METHODS} fee={fee} waived={waived} buyer={(me!.billing ?? null) as Buyer | null} {...await checkoutCards(me!.id)} />
      </div>
    </div>
  );
}
