"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { fetchSiteStatus } from "@/components/site-status";

/**
 * Error boundary for every page under the locale layout, so the header and footer stay. If the database is down the
 * page reads as scheduled maintenance (details for admins are in the bar under the header); otherwise a plain error.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("dbDown");
  const router = useRouter();
  const [dbDown, setDbDown] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchSiteStatus().then((s) => alive && setDbDown(s?.db ? !s.db.ok : false));
    return () => {
      alive = false;
    };
  }, [error]);

  if (dbDown === null) return <div className="container-x min-h-[40vh] py-16" aria-busy="true" />;

  const retry = () => {
    router.refresh();
    reset();
  };
  return (
    <div className="container-x flex min-h-[50vh] items-center justify-center py-16">
      <div className="card w-full max-w-lg p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Icon name={dbDown ? "database" : "alert"} className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">{dbDown ? t("pageTitle") : t("errTitle")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{dbDown ? t("pageBody") : t("errBody")}</p>
        <button type="button" onClick={retry} className="btn-primary mt-6">{t("retry")}</button>
        {!dbDown && error.digest && <p className="mt-4 font-mono text-xs text-muted">{error.digest}</p>}
      </div>
    </div>
  );
}
