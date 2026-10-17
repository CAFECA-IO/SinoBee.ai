"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Corner ribbon on every page while the site is in test mode. Asked from the browser (/api/site) so statically
 * rendered pages follow the admin switch too.
 */
export function TestRibbon() {
  const t = useTranslations("test");
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/site", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { testMode?: boolean }) => alive && setOn(!!j.testMode))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!on) return null;
  return (
    <div className="test-ribbon" role="note" aria-label={t("banner")} title={t("banner")}>
      <span>{t("ribbon")}</span>
    </div>
  );
}
