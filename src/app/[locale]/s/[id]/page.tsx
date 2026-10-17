import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { loadShare, readDoc } from "@/lib/shares/service";
import { shareMetadata } from "@/lib/shares/metadata";
import { viewCap } from "@/lib/shares/view-cap";
import { SharedDoc, encodePath, isDocFile } from "@/components/share-doc";
import { certUrl, formatCode } from "@/lib/boltchain/certificates";
import { Markdown } from "@/components/markdown";
import { LocalDate } from "@/components/date";
import { MermaidBlocks } from "@/components/mermaid-blocks";
import { ContinueInSinoBee, ShareOwnerActions, ShareReport } from "@/components/share-actions";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  return shareMetadata((await params).id);
}

export default async function SharePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("share");
  const me = await currentUser();
  const { share, access } = await loadShare(id, me);
  if (!share) notFound();
  if (!access.ok) {
    const msg = access.reason === "login" ? t("needLogin") : access.reason === "not_allowed" ? t("notAllowed") : access.reason === "expired" ? t("expired") : t("revoked");
    return (
      <div className="container-x flex justify-center py-20">
        <div className="card max-w-md space-y-4 p-8 text-center">
          <h1 className="text-xl font-bold">{t("unavailable")}</h1>
          <p className="text-muted">{msg}</p>
          {access.reason === "login" && <Link className="btn-primary" href={`/login?next=/s/${id}`}>{t("login")}</Link>}
          {access.reason === "not_allowed" && me && <p className="break-all font-mono text-xs text-muted">{me.account}</p>}
        </div>
      </div>
    );
  }
  const isOwner = me?.id === share.ownerId;
  if (!isOwner) await db.conversationShare.update({ where: { id }, data: { views: { increment: 1 } } });
  const doc = await readDoc(share.objectKey);
  const fileUrl = (fid: string) => `/api/shares/${id}/files/${fid}`;
  const cap = viewCap(id);
  const docHref = (p: string) => `/s/${id}/v/${encodePath(p)}`;
  const byId = new Map(doc.files.map((f) => [f.id, f]));
  // reports and pages the conversation links open in the share's document view; their own files are not listed
  const linked = new Set(doc.messages.flatMap((m) => [...m.text.matchAll(/\]\(files\/(\d+)\)/g)].map((x) => x[1])));
  const listed = doc.files.filter((f) => !f.name.includes("/") || linked.has(f.id));
  const media = new Map(doc.files.filter((f) => /^(video|audio)\//.test(f.mime)).map((f) => [f.id, f]));
  // images render inline; videos and audio play in the attachments section (markdown cannot embed them safely)
  const fix = (text: string) =>
    text
      .replace(/!\[([^\]]*)\]\(files\/(\d+)\)/g, (m0, alt, fid) => (media.has(fid) ? `[▶ ${alt || media.get(fid)!.name}](#file-${fid})` : m0))
      .replace(/\]\(files\/(\d+)\)/g, (_m, fid) => {
        const f = byId.get(fid);
        return `](${f && isDocFile(f) ? docHref(f.name) : fileUrl(fid)})`;
      });
  const access_ = isOwner ? await db.shareAccess.findMany({ where: { shareId: id } }) : [];
  return (
    <div className="container-x max-w-4xl space-y-6 py-10">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="chip">{t(`vis.${share.visibility}`)}{share.restricted ? ` · ${t("restricted")}` : ""}</span>
          {doc.model && <span className="chip font-mono">{doc.model}</span>}
          {(doc.skills ?? []).map((k) => <span key={k} className="chip font-mono">skill: {k}</span>)}
          <span className="text-muted">{t("views", { n: share.views })}</span>
        </div>
        <h1 className="h1">{share.title}</h1>
        <p className="text-sm text-muted">
          {t("by")} {share.owner.handle ? `@${share.owner.handle}` : share.owner.account.slice(0, 10) + "…"} · <LocalDate value={share.createdAt} />
          {share.expiresAt && <> · {t("until")} <LocalDate value={share.expiresAt} withTime={false} /></>}
        </p>
        {share.description && <p className="text-[15px] leading-relaxed text-ink/90">{share.description}</p>}
        {doc.redactions.some((r) => r.count > 0) && (
          <p className="rounded-xl bg-accent-soft p-3 text-xs">{t("redacted", { list: doc.redactions.filter((r) => r.count > 0).map((r) => `${t(`rk.${r.kind}`)} × ${r.count}`).join("、") })}</p>
        )}
      </header>

      {share.kind === "doc" && share.entry ? (
        <SharedDoc id={id} cap={cap} files={share.files} path={share.entry} docHref={docHref} fullHref={`${docHref(share.entry)}?full=1`} fullLabel={t("fullscreen")} title={share.title} />
      ) : (
      <MermaidBlocks>
        <div className="space-y-4">
          {doc.messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-accent-soft px-4 py-3" : "card px-5 py-4"}>
              <div className="mb-1 text-xs font-semibold text-muted">{m.role === "user" ? t("user") : "SinoBee"}</div>
              {m.text && <Markdown>{fix(m.text)}</Markdown>}
              {m.tools && m.tools.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-muted">{t("tools", { n: m.tools.length })}: {m.tools.map((x) => x.name).join(", ")}</summary>
                  {m.tools.map((x, j) => (
                    <div key={j} className="mt-2 space-y-1">
                      <div className="font-mono font-semibold">{x.name}</div>
                      {x.input && <pre className="codeblock max-h-48 whitespace-pre-wrap">{x.input}</pre>}
                      {x.output && <pre className="codeblock max-h-64 whitespace-pre-wrap">{x.output}</pre>}
                    </div>
                  ))}
                </details>
              )}
            </div>
          ))}
        </div>
      </MermaidBlocks>
      )}

      {share.kind !== "doc" && listed.length > 0 && (
        <section className="card space-y-3 p-5 text-sm">
          <h2 className="h3">{t("files")}</h2>
          {listed.map((f) => (
            <div key={f.id} id={`file-${f.id}`} className="space-y-2">
              {f.mime.startsWith("video/") && <video src={fileUrl(f.id)} controls preload="metadata" className="w-full max-w-2xl rounded-lg" />}
              {f.mime.startsWith("audio/") && <audio src={fileUrl(f.id)} controls className="w-full max-w-md" />}
              <a href={isDocFile(f) ? docHref(f.name) : fileUrl(f.id)} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-accent hover:border-accent">
                <span className="truncate">{isDocFile(f) ? "📄" : "📎"} {f.name.split("/").pop()}</span>
                <span className="shrink-0 text-xs text-muted">{f.size >= 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.ceil(f.size / 1024)} KiB`}</span>
              </a>
            </div>
          ))}
        </section>
      )}

      <ContinueInSinoBee url={`${config.origin}/s/${id}`} />

      <section className="card space-y-2 p-5 text-sm">
        <h2 className="h3">{t("integrity")}</h2>
        <div className="break-all font-mono text-xs text-muted">{share.contentHash}</div>
        {share.anchorCode ? (
          <p>{t("anchored")} <a className="font-mono text-accent" href={certUrl(share.anchorCode)} target="_blank" rel="noopener">{formatCode(share.anchorCode)}</a></p>
        ) : (
          <p className="text-muted">{t("anchorPending")}</p>
        )}
      </section>

      {isOwner ? (
        <ShareOwnerActions id={id} visibility={share.visibility} accounts={access_.map((a) => a.account)} description={share.description ?? ""} thumbnail={share.ogKey ? `/api/shares/${id}/og` : null} />
      ) : (
        me && <ShareReport id={id} />
      )}
      <p className="text-center text-xs text-muted">{t("footer")}</p>
    </div>
  );
}
