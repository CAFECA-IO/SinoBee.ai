import { getTranslations } from "next-intl/server";
import { config } from "@/lib/config";

/** Corner ribbon shown on the home page and in the admin while the site is in test mode */
export async function TestRibbon() {
  if (!config.testMode) return null;
  const t = await getTranslations("test");
  return (
    <div className="test-ribbon" role="note" aria-label={t("banner")} title={t("banner")}>
      <span>{t("ribbon")}</span>
    </div>
  );
}
