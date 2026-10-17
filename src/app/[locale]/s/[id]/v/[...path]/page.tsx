import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { loadShare } from "@/lib/shares/service";
import { shareMetadata } from "@/lib/shares/metadata";
import { viewCap } from "@/lib/shares/view-cap";
import { SharedDoc, encodePath, isDocFile } from "@/components/share-doc";

export const dynamic = "force-dynamic";

type Params = { locale: string; id: string; path: string[] };
const pathOf = (parts: string[]) => parts.map((p) => { try { return decodeURIComponent(p); } catch { return p; } }).join("/");

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { id, path } = await params;
  return shareMetadata(id, pathOf(path));
}

/** A report or page inside a share (linked from a shared conversation, or a document share's own links) */
export default async function SharedDocPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ full?: string }> }) {
  const { locale, id, path: parts } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("share");
  const path = pathOf(parts);
  const { share, access } = await loadShare(id, await currentUser());
  if (!share || !access.ok) {
    if (!share) notFound();
    return (
      <div className="container-x flex justify-center py-20">
        <div className="card max-w-md space-y-4 p-8 text-center">
          <h1 className="text-xl font-bold">{t("unavailable")}</h1>
          <Link className="btn-primary" href={`/s/${id}`}>{t("back")}</Link>
        </div>
      </div>
    );
  }
  const f = share.files.find((x) => x.name === path);
  if (!f || !isDocFile(f)) notFound();
  const docHref = (p: string) => `/s/${id}/v/${encodePath(p)}`;
  const full = (await searchParams).full === "1";
  return (
    <div className={full ? "px-2 py-2" : "container-x max-w-5xl space-y-4 py-8"}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/s/${id}`} className="text-accent">← {share.title}</Link>
        <span className="text-muted">/ {path.split("/").pop()}</span>
      </div>
      <SharedDoc id={id} cap={viewCap(id)} files={share.files} path={path} docHref={docHref} title={share.title}
        fullHref={full ? undefined : `${docHref(path)}?full=1`} fullLabel={t("fullscreen")} />
    </div>
  );
}
