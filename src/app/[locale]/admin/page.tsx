import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { ReviewActions, VerifyPublisher } from "@/components/admin-actions";
import { StatusBadge } from "@/components/status-badge";
import { LocalDate } from "@/components/date";
import { hubPublicKeys } from "@/lib/skills/signing";

export const dynamic = "force-dynamic";

export default async function AdminPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  setRequestLocale((await params).locale);
  const me = await currentUser();
  if (!me?.isAdmin) notFound();
  const t = await getTranslations("admin");
  const tab = (await searchParams).tab === "approved" ? "approved" : "pending";
  const versions = await db.skillVersion.findMany({
    where: tab === "pending" ? { status: "PENDING_REVIEW" } : { status: "APPROVED" },
    include: { skill: { include: { publisher: true } } },
    orderBy: { publishedAt: tab === "pending" ? "asc" : "desc" },
    take: 100,
  });
  const keys = hubPublicKeys();
  return (
    <div className="container-x space-y-6 py-12">
      <h1 className="h1">{t("title")}</h1>
      {!keys.length && <p className="rounded-xl bg-warn-soft p-4 text-sm text-warn">{t("noKey")}</p>}
      <div className="flex gap-2">
        <Link href="/admin" className={tab === "pending" ? "btn-primary" : "btn-ghost"}>{t("pending")}</Link>
        <Link href="/admin?tab=approved" className={tab === "approved" ? "btn-primary" : "btn-ghost"}>{t("approved")}</Link>
      </div>
      {versions.length === 0 && <p className="text-muted">{t("empty")}</p>}
      <div className="space-y-4">
        {versions.map((v) => (
          <div key={v.id} className="card space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/skills/${v.skill.publisher.publisher}/${v.skill.name}?v=${v.version}`} className="font-mono font-semibold text-accent">
                {v.skill.publisher.publisher}/{v.skill.name}@{v.version}
              </Link>
              <StatusBadge status={v.status} />
              <span className={`badge ${v.scanVerdict === "CLEAN" ? "bg-accent-soft text-ok" : "bg-warn-soft text-warn"}`}>scan: {v.scanVerdict}</span>
              <span className="text-xs text-muted"><LocalDate value={v.publishedAt} /></span>
              <VerifyPublisher userId={v.skill.publisherId} verified={v.skill.publisher.publisherVerified} />
            </div>
            <p className="text-sm text-muted">{v.skill.description}</p>
            {(v.scanFindings as { file: string; rule: string; excerpt: string }[]).length > 0 && (
              <ul className="list-disc pl-5 text-xs text-warn">
                {(v.scanFindings as { file: string; rule: string; excerpt: string }[]).map((f, i) => (
                  <li key={i}>{f.file}: {f.rule} — {f.excerpt}</li>
                ))}
              </ul>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-accent">SKILL.md</summary>
              <pre className="codeblock mt-2 max-h-96 whitespace-pre-wrap">{v.skillMd}</pre>
            </details>
            <ReviewActions versionId={v.id} approved={v.status === "APPROVED"} />
          </div>
        ))}
      </div>
    </div>
  );
}
