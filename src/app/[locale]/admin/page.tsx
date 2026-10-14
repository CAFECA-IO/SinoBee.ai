import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { ReviewActions, VerifyPublisher } from "@/components/admin-actions";
import { StatusBadge } from "@/components/status-badge";
import { LocalDate } from "@/components/date";
import { hubPublicKeys } from "@/lib/skills/signing";
import { storageStatus } from "@/lib/boltchain/keeper";
import { ToolReview, ReportActions } from "@/components/admin-actions";
import type { ToolManifest } from "@/lib/tools/spec";

export const dynamic = "force-dynamic";

export default async function AdminPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  setRequestLocale((await params).locale);
  const me = await currentUser();
  if (!me?.isAdmin) notFound();
  const t = await getTranslations("admin");
  const raw = (await searchParams).tab ?? "pending";
  const tab = ["approved", "tools", "storage", "reports"].includes(raw) ? raw : "pending";
  const tabs = (
    <div className="flex flex-wrap gap-2">
      {(["pending", "approved", "tools", "reports", "storage"] as const).map((k) => (
        <Link key={k} href={k === "pending" ? "/admin" : `/admin?tab=${k}`} className={tab === k ? "btn-primary" : "btn-ghost"}>{t(`tab.${k}`)}</Link>
      ))}
    </div>
  );
  if (tab === "tools" || tab === "storage" || tab === "reports")
    return (
      <div className="container-x space-y-6 py-12">
        <h1 className="h1">{t("title")}</h1>
        {tabs}
        {tab === "tools" && <ToolReviews />}
        {tab === "storage" && <StorageStatus />}
        {tab === "reports" && <Reports />}
      </div>
    );
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
      {tabs}
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

async function ToolReviews() {
  const t = await getTranslations("admin");
  const rows = await db.toolVersion.findMany({ where: { status: "PENDING_REVIEW" }, include: { tool: { include: { owner: true } } }, orderBy: { publishedAt: "asc" }, take: 100 });
  if (!rows.length) return <p className="text-muted">{t("empty")}</p>;
  return (
    <div className="space-y-4">
      {rows.map((v) => {
        const m = v.manifest as ToolManifest;
        return (
          <div key={v.id} className="card space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/tools/${v.tool.owner.publisher}/${v.tool.name}`} className="font-mono font-semibold text-accent">{v.tool.owner.publisher}/{v.tool.name}@{v.version}</Link>
              <span className="chip">{m.database.engine}</span>
              <span className="text-xs text-muted"><LocalDate value={v.publishedAt} /></span>
            </div>
            <p className="text-sm text-muted">{m.title} — {m.description}</p>
            {(v.scanFindings as { level: string; path: string; message: string }[]).length > 0 && (
              <ul className="list-disc pl-5 text-xs text-warn">
                {(v.scanFindings as { level: string; path: string; message: string }[]).map((f, i) => <li key={i}>{f.path}: {f.message}</li>)}
              </ul>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-accent">TOOL.json</summary>
              <pre className="codeblock mt-2 max-h-96 whitespace-pre-wrap">{JSON.stringify(m, null, 2)}</pre>
            </details>
            <ToolReview versionId={v.id} />
          </div>
        );
      })}
    </div>
  );
}

async function StorageStatus() {
  const t = await getTranslations("admin");
  const s = await storageStatus();
  const failing = await db.storageObject.findMany({ where: { error: { not: null }, status: { in: ["PENDING", "STORED"] } }, orderBy: { updatedAt: "desc" }, take: 20 });
  const anchors = await db.anchor.groupBy({ by: ["status"], _count: { _all: true } });
  const bolt = (wei?: string) => (wei ? (Number(BigInt(wei) / 10n ** 12n) / 1e6).toFixed(4) : "—");
  return (
    <div className="space-y-4">
      <section className="card space-y-2 p-6 text-sm">
        <h2 className="h3">Boltchain</h2>
        <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
          <span className="text-muted">{t("st.enabled")}</span><span>{s.enabled ? "✓" : t("st.off")}</span>
          {"wallet" in s && (<><span className="text-muted">{t("st.wallet")}</span><span className="break-all font-mono">{s.wallet}</span><span className="text-muted">{t("st.balance")}</span><span className="font-mono">{bolt(s.balance)} BOLT</span><span className="text-muted">epoch</span><span className="font-mono">{s.epoch}</span></>)}
          {"low" in s && s.low && (<><span className="text-muted">⚠</span><span className="text-warn">{t("st.low")}</span></>)}
          {"error" in s && (<><span className="text-muted">{t("st.error")}</span><span className="text-err">{s.error}</span></>)}
          <span className="text-muted">{t("st.certificates")}</span><span className="break-all font-mono">{s.certificates ?? "—"}</span>
        </div>
      </section>
      <section className="card p-6 text-sm">
        <h2 className="h3">{t("st.objects")}</h2>
        <table className="mt-3 w-full">
          <tbody>
            {s.groups.map((g) => (
              <tr key={g.status} className="border-t border-line"><td className="py-2">{g.status}</td><td className="py-2 font-mono">{g._count._all}</td><td className="py-2 font-mono text-muted">{String(g._sum.size ?? 0)} B</td></tr>
            ))}
            {anchors.map((g) => (
              <tr key={`a-${g.status}`} className="border-t border-line"><td className="py-2">{t("st.anchors")} · {g.status}</td><td className="py-2 font-mono">{g._count._all}</td><td /></tr>
            ))}
          </tbody>
        </table>
      </section>
      {failing.length > 0 && (
        <section className="card p-6 text-sm">
          <h2 className="h3">{t("st.errors")}</h2>
          {failing.map((o) => <div key={o.key} className="border-t border-line py-2"><span className="font-mono">{o.key}</span> <span className="text-err">{o.error}</span></div>)}
        </section>
      )}
    </div>
  );
}

async function Reports() {
  const t = await getTranslations("admin");
  const rows = await db.report.findMany({ where: { resolvedAt: null }, include: { reporter: true }, orderBy: { createdAt: "asc" }, take: 100 });
  if (!rows.length) return <p className="text-muted">{t("empty")}</p>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="card space-y-2 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="chip">{r.targetType}</span>
            {r.targetType === "share" ? <Link href={`/s/${r.targetId}`} className="font-mono text-accent">/s/{r.targetId}</Link> : <ToolLink id={r.targetId} />}
            <span className="text-xs text-muted">@{r.reporter.handle ?? r.reporter.account} · <LocalDate value={r.createdAt} /></span>
          </div>
          <p>{r.reason}</p>
          <ReportActions reportId={r.id} targetType={r.targetType} targetId={r.targetId} />
        </div>
      ))}
    </div>
  );
}

async function ToolLink({ id }: { id: string }) {
  const t = await db.tool.findUnique({ where: { id }, include: { owner: true } });
  if (!t) return <span className="font-mono">{id}</span>;
  return <Link href={`/tools/${t.owner.publisher ?? t.owner.account}/${t.name}`} className="font-mono text-accent">{t.owner.publisher}/{t.name}</Link>;
}
