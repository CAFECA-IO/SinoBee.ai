import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { findTool } from "@/lib/tools/service";
import { compareVersions } from "@/lib/skills/spec";
import { certUrl, formatCode } from "@/lib/boltchain/certificates";
import type { ToolManifest } from "@/lib/tools/spec";
import { CopyCode } from "@/components/copy-code";
import { StatusBadge } from "@/components/status-badge";
import { LocalDate } from "@/components/date";
import { ToolOwnerActions } from "@/components/tool-owner-actions";
import { RateSkill } from "@/components/rate-skill";
import { Stars } from "@/components/stars";
import { Markdown } from "@/components/markdown";
import { ShareReport } from "@/components/share-actions";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const ENGINE: Record<string, string> = { postgres: "PostgreSQL", mysql: "MySQL / MariaDB", sqlite: "SQLite" };

export default async function ToolPage({ params }: { params: Promise<{ locale: string; owner: string; name: string }> }) {
  const { locale, owner, name } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools");
  const me = await currentUser();
  const found = await findTool(me, owner, name).catch(() => null);
  if (!found) notFound();
  const { tool, versions, isOwner } = found;
  const v = [...versions].sort((a, b) => compareVersions(b.version, a.version))[0];
  const m = v.manifest as ToolManifest;
  const d = m.database;
  return (
    <div className="container-x max-w-4xl space-y-6 py-12">
      <div className="flex flex-wrap items-center gap-3">
        <span className="chip">{ENGINE[d.engine]}</span>
        <span className="chip">{tool.visibility === "PUBLIC" ? t("public") : t("private")}</span>
        {isOwner && <StatusBadge status={v.status} />}
      </div>
      <h1 className="h1">{m.title}</h1>
      <p className="font-mono text-sm text-muted">{owner}/{tool.name}@{v.version} · <LocalDate value={v.publishedAt} /></p>
      {tool.visibility === "PUBLIC" && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Stars value={tool.ratingAvg} /> <span className="text-muted">{tool.ratingCount ? `${tool.ratingAvg.toFixed(1)} · ${t("ratings", { n: tool.ratingCount })}` : t("noRatings")}</span>
          {me && !isOwner && <RateSkill skillId={tool.id} url={`/api/tools/${tool.id}/rate`} mine={(await db.toolRating.findUnique({ where: { toolId_userId: { toolId: tool.id, userId: me.id } } }))?.stars ?? 0} />}
        </div>
      )}
      {m.description && <p className="whitespace-pre-wrap">{m.description}</p>}

      <section className="card space-y-3 p-6">
        <h2 className="h3">{t("install")}</h2>
        <p className="text-sm text-muted">{t("installHelp")}</p>
        <CopyCode code={`sinobee tools install ${owner}/${tool.name}`} />
      </section>

      <section className="card space-y-2 p-6 text-sm">
        <h2 className="h3">{t("connection")}</h2>
        <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
          <span className="text-muted">{t("engine")}</span><span>{ENGINE[d.engine]}</span>
          {d.host && (<><span className="text-muted">{t("host")}</span><span className="font-mono">{d.host}{d.port ? `:${d.port}` : ""}</span></>)}
          {d.database && (<><span className="text-muted">{t("database")}</span><span className="font-mono">{d.database}</span></>)}
          {d.file && (<><span className="text-muted">{t("file")}</span><span className="font-mono">{d.file}</span></>)}
          <span className="text-muted">{t("mode")}</span><span>{d.readOnly ? t("readOnly") : t("readWrite")} · {t("limits", { rows: d.rowLimit, secs: d.timeoutS })}</span>
          <span className="text-muted">{t("credentials")}</span><span>{m.vaultPack && isOwner ? t("inVault") : t("ownCredentials")}</span>
        </div>
      </section>

      {m.tables && m.tables.length > 0 && (
        <section className="card overflow-x-auto p-6">
          <h2 className="h3">{t("tables", { n: m.tables.length })}</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {m.tables.slice(0, 200).map((x) => (
                <tr key={`${x.schema}.${x.name}`} className="border-t border-line align-top">
                  <td className="py-2 pr-4 font-mono">{x.schema ? `${x.schema}.` : ""}{x.name}</td>
                  <td className="py-2 font-mono text-xs text-muted">{(x.columns ?? []).map((c) => c.name + (c.type ? ` ${c.type}` : "")).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {m.queries && m.queries.length > 0 && (
        <section className="card space-y-3 p-6">
          <h2 className="h3">{t("queries")}</h2>
          {m.queries.map((q) => (
            <div key={q.title}>
              <div className="text-sm font-semibold">{q.title}</div>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-code p-3 text-xs">{q.sql}</pre>
            </div>
          ))}
        </section>
      )}

      {m.notes && Object.keys(m.notes).length > 0 && (
        <section className="card space-y-2 p-6 text-sm">
          <h2 className="h3">{t("notes")}</h2>
          {Object.entries(m.notes).map(([k, v]) => (
            <div key={k} className="grid gap-1 sm:grid-cols-[220px_1fr]"><span className="font-mono text-xs">{k}</span><span>{v}</span></div>
          ))}
        </section>
      )}

      {m.skill && (
        <section className="card space-y-2 p-6">
          <details>
            <summary className="h3 cursor-pointer">SKILL.md</summary>
            <div className="mt-3"><Markdown>{m.skill.replace(/^---[\s\S]*?---\n/, "")}</Markdown></div>
          </details>
        </section>
      )}

      <section className="card space-y-2 p-6 text-sm">
        <h2 className="h3">{t("integrity")}</h2>
        <div className="break-all font-mono text-xs">{v.contentHash}</div>
        {v.anchorCode ? (
          <p>
            {t("anchored")} <a className="font-mono text-accent" href={certUrl(v.anchorCode)} target="_blank" rel="noopener">{formatCode(v.anchorCode)}</a>
          </p>
        ) : (
          <p className="text-muted">{t("anchorPending")}</p>
        )}
      </section>

      {isOwner && <ToolOwnerActions name={tool.name} visibility={tool.visibility} />}
      {!isOwner && me && tool.visibility === "PUBLIC" && <ShareReport id={tool.id} targetType="tool" />}
    </div>
  );
}
