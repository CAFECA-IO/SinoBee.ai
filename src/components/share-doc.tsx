import { getObject } from "@/lib/storage";
import { rawBase } from "@/lib/shares/view-cap";
import { PAGE, encodePath, rebaseMarkdown } from "@/lib/shares/doc-paths";
import { Markdown } from "@/components/markdown";
import { MermaidBlocks } from "@/components/mermaid-blocks";

type File = { name: string; objectKey: string; mime: string };
export { encodePath, isDocFile } from "@/lib/shares/doc-paths";

/** One document of a share: a Markdown report rendered here, or an HTML/SVG page running in a sandboxed frame */
export async function SharedDoc({ id, cap, files, path, docHref, fullHref, fullLabel = "⤢", title }: {
  id: string; cap: string; files: File[]; path: string; docHref: (p: string) => string; fullHref?: string; fullLabel?: string; title: string;
}) {
  const f = files.find((x) => x.name === path);
  if (!f) return <p className="text-muted">—</p>;
  if (PAGE.test(f.mime)) {
    return (
      <div className="space-y-2">
        <iframe
          title={title}
          src={rawBase(id, cap) + encodePath(path)}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
          referrerPolicy="no-referrer"
          className={`block ${fullHref ? "h-[78vh]" : "h-[calc(100vh-7rem)]"} min-h-[480px] w-full rounded-2xl border border-line bg-white`}
        />
        {fullHref && (
          <div className="text-right text-xs">
            <a className="text-accent" href={fullHref}>⤢ {fullLabel}</a>
          </div>
        )}
      </div>
    );
  }
  const text = (await getObject(f.objectKey)).toString("utf8");
  const names = new Set(files.map((x) => x.name));
  return (
    <article className="card px-5 py-6 sm:px-10 sm:py-8">
      <MermaidBlocks>
        <Markdown>{rebaseMarkdown(text, path, names, id, cap, docHref)}</Markdown>
      </MermaidBlocks>
    </article>
  );
}
