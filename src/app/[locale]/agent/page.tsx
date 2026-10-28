import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { agentAccess } from "@/lib/agent-access";
import { Link, redirect } from "@/i18n/navigation";
import { AgentLauncher } from "@/components/agent-launcher";
import { CopyCode } from "@/components/copy-code";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "agent" });
  return { title: t("title") };
}

/** 線上使用: sign in, then open the user's own SinoBee (its container starts on first use) */
export default async function AgentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("agent");
  const access = await agentAccess();
  if (!access.allowed) return <ComingSoon t={t} />;
  const me = await currentUser();
  if (!me) redirect({ href: "/login?next=/agent", locale });
  return (
    <>
      {!access.online && (
        <div role="status" className="border-b border-warn/30 bg-warn-soft text-warn">
          <div className="container-x flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2.5 text-center text-sm">
            <Icon name="shield" className="h-4 w-4 flex-none" />
            <span>
              <strong className="font-semibold">{t("adminPreview")}</strong> · {t("adminPreviewBody")}
            </span>
            <Link href="/admin?tab=settings&group=site" className="font-semibold underline">
              {t("adminSwitch")}
            </Link>
          </div>
        </div>
      )}
      <div className="container-x flex justify-center py-16">
        <div className="card w-full max-w-md space-y-4 p-8 text-center">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted">{t("lead")}</p>
          <AgentLauncher />
        </div>
      </div>
    </>
  );
}

function ComingSoon({ t }: { t: Awaited<ReturnType<typeof getTranslations<"agent">>> }) {
  return (
    <div className="container-x flex justify-center py-16">
      <div className="card w-full max-w-lg p-8 text-center sm:p-10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Icon name="rocket" className="h-7 w-7" />
        </div>
        <span className="badge mt-5 bg-warn-soft text-warn">Coming soon</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{t("soonTitle")}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">{t("soonBody")}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/download" className="btn-primary">
            <Icon name="download" />
            {t("soonDownload")}
          </Link>
          <Link href="/" className="btn-ghost">
            {t("soonHome")}
          </Link>
        </div>
        <div className="mt-7 text-left">
          <CopyCode code={"git clone https://github.com/CAFECA-IO/SinoBee.git && cd SinoBee\ndocker compose up -d --build"} />
        </div>
      </div>
    </div>
  );
}
