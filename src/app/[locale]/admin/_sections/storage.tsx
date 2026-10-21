import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { storageStatus } from "@/lib/boltchain/keeper";
import { Link } from "@/i18n/navigation";
import { Banner, Empty, KV, PageHead, Tag } from "@/components/admin/kit";

const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`);

export async function StorageStatus() {
  const t = await getTranslations("admin.st");
  const ta = await getTranslations("admin");
  const s = await storageStatus();
  const [failing, anchors] = await Promise.all([
    db.storageObject.findMany({ where: { error: { not: null }, status: { in: ["PENDING", "STORED"] } }, orderBy: { updatedAt: "desc" }, take: 20 }),
    db.anchor.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const bolt = (wei?: string) => (wei ? (Number(BigInt(wei) / 10n ** 12n) / 1e6).toFixed(4) : "—");
  return (
    <div className="space-y-4">
      <PageHead title={ta("tab.storage")}>
        <Tag tone={s.enabled ? "ok" : "muted"}>{s.enabled ? t("on") : t("offShort")}</Tag>
      </PageHead>
      {!s.enabled && (
        <Banner tone="info" title={t("offTitle")} action={<Link className="btn-ghost !py-1.5" href="/admin?tab=settings&group=boltchain">{t("setUp")}</Link>}>{t("off")}</Banner>
      )}
      {"low" in s && s.low && <Banner tone="warn" title={t("low")} />}
      {"error" in s && s.error && <Banner tone="err" title={t("error")}>{s.error}</Banner>}
      {s.enabled && (
        <section className="card p-4 text-sm">
          <KV
            rows={[
              ...("wallet" in s ? ([[t("wallet"), <span key="w" className="break-all font-mono">{s.wallet}</span>], [t("balance"), <span key="b" className="font-mono">{bolt(s.balance)} BOLT</span>], ["epoch", <span key="e" className="font-mono">{s.epoch}</span>]] as [string, React.ReactNode][]) : []),
              [t("certificates"), <span key="c" className="break-all font-mono">{s.certificates ?? "—"}</span>],
            ]}
          />
        </section>
      )}
      <section className="card overflow-hidden text-sm">
        <h2 className="h3 border-b border-line px-4 py-3">{t("objects")}</h2>
        {s.groups.length === 0 && anchors.length === 0 ? (
          <div className="p-4"><Empty>{t("noObjects")}</Empty></div>
        ) : (
          <table className="w-full">
            <tbody>
              {s.groups.map((g) => (
                <tr key={g.status} className="border-b border-line last:border-0"><td className="px-4 py-2">{g.status}</td><td className="px-4 py-2 text-right font-mono">{g._count._all}</td><td className="px-4 py-2 text-right font-mono text-muted">{bytes(Number(g._sum.size ?? 0))}</td></tr>
              ))}
              {anchors.map((g) => (
                <tr key={`a-${g.status}`} className="border-b border-line last:border-0"><td className="px-4 py-2">{t("anchors")} · {g.status}</td><td className="px-4 py-2 text-right font-mono">{g._count._all}</td><td /></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {failing.length > 0 && (
        <section className="card overflow-hidden text-sm">
          <h2 className="h3 border-b border-line px-4 py-3">{t("errors")}</h2>
          <ul className="divide-y divide-line">
            {failing.map((o) => <li key={o.key} className="px-4 py-2"><span className="break-all font-mono text-xs">{o.key}</span> <span className="text-err">{o.error}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
