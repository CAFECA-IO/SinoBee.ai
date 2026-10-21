import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ChecklistEditor } from "@/components/checklist-editor";
import { DIMENSIONS, MIN_ITEMS, currentChecklist, draftChecklist, publishedVersions } from "@/lib/crowd/checklist";
import { LocalDate } from "@/components/date";
import { PageHead } from "@/components/admin/kit";

/** The public screening checklist: edit the draft by hand or with AI, publish versions */
export async function ChecklistAdmin() {
  const t = await getTranslations("checklist");
  const ta = await getTranslations("admin");
  const [cur, draft, versions] = await Promise.all([currentChecklist(), draftChecklist(), publishedVersions()]);
  return (
    <div className="space-y-5">
      <PageHead title={ta("tab.checklist")} sub={<>{t("current", { v: cur.version, n: cur.items.length })} · <Link href="/crowd-terms" className="text-accent">/crowd-terms</Link></>} />
      <ChecklistEditor items={draft.items} dimensions={DIMENSIONS} min={MIN_ITEMS} version={cur.version} changed={draft.changed} />
      <details className="card">
        <summary className="cursor-pointer px-4 py-3 font-semibold">{t("history")} · {versions.length}</summary>
        <ul className="divide-y divide-line border-t border-line text-sm">
          {versions.map((v, i) => (
            <li key={`${v.version}-${i}`} className="flex flex-wrap gap-3 px-4 py-2.5">
              <span className="chip">v{v.version}</span>
              <span className="text-muted">{(v.items as unknown[]).length}</span>
              <span className="min-w-0 flex-1">{v.note}</span>
              {v.publishedAt && <span className="text-xs text-muted"><LocalDate value={v.publishedAt} /></span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
