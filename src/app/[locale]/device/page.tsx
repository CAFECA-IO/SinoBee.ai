import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { pendingByUserCode, formatUserCode, normalizeUserCode } from "@/lib/device-flow";
import { redirect } from "@/i18n/navigation";
import { DeviceApprove } from "@/components/device-approve";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "device" });
  return { title: t("title") };
}

/** Approve a `sinobee login` request (RFC 8628 verification URI) */
export default async function DevicePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ code?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const code = normalizeUserCode((await searchParams).code ?? "").slice(0, 8);
  const me = await currentUser();
  if (!me) redirect({ href: `/login?next=${encodeURIComponent(`/device${code ? `?code=${formatUserCode(code)}` : ""}`)}`, locale });
  const t = await getTranslations("device");
  const pending = code.length === 8 ? await pendingByUserCode(code) : null;
  return (
    <div className="container-x flex justify-center py-16">
      <div className="card w-full max-w-md space-y-4 p-8">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted">{t("lead")}</p>
        <DeviceApprove
          account={me!.account}
          initialCode={code ? formatUserCode(code) : ""}
          request={pending ? { deviceName: pending.deviceName, platform: pending.platform, scopes: pending.scopes.split(" "), createdAt: pending.createdAt.toISOString() } : null}
        />
      </div>
    </div>
  );
}
