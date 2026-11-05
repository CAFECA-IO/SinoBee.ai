"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { readDrafts, type StoredDraft } from "./admin-site-settings";

/** 站台健康 → changes made on the settings page but not applied yet (kept in this browser) */
export function DraftsCard() {
  const t = useTranslations("admin.health");
  const [drafts, setDrafts] = useState<StoredDraft[] | null>(null);
  useEffect(() => setDrafts(readDrafts()), []);
  const n = drafts?.length ?? 0;
  return (
    <section className="card space-y-2 p-4" aria-labelledby="h-drafts">
      <h2 id="h-drafts" className="h3">{t("draftsTitle", { n })}</h2>
      {n === 0 ? (
        <p className="text-sm text-muted">{t("draftsNone")}</p>
      ) : (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {drafts!.map((d) => (
              <li key={d.key}><Link href={`/admin?tab=settings&setting=${d.key}`} className="hover:underline">{d.where}</Link></li>
            ))}
          </ul>
          <Link href={`/admin?tab=settings&setting=${drafts![0].key}`} className="btn-primary !py-2">{t("draftsReview")}</Link>
        </>
      )}
    </section>
  );
}
