import { rawBase } from "./view-cap";

export const PAGE = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml)$/;
export const MD = /\.(md|markdown)$/i;
export const isDocFile = (f: { name: string; mime: string }) => PAGE.test(f.mime) || MD.test(f.name);
export const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** posix join + normalize; null when the path climbs out of the share */
export function joinPath(dir: string, ref: string): string | null {
  const out: string[] = [];
  for (const part of `${dir}/${ref}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/**
 * Relative images and links in a shared Markdown report point at the share's own files: pictures load through the
 * capability URL, other reports and pages open in the share's document view, anything else downloads.
 */
export function rebaseMarkdown(text: string, path: string, names: Set<string>, id: string, cap: string, docHref: (p: string) => string) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return text.replace(/(!?)(\[[^\]]*\]\()(<[^>]+>|[^)\s]+)/g, (m, bang: string, head: string, url: string) => {
    const raw = url.startsWith("<") ? url.slice(1, -1) : url;
    if (/^(?:[a-z][\w+.-]*:|\/\/|#|\/)/i.test(raw)) return m;
    let ref = raw.split(/[?#]/)[0];
    try {
      ref = decodeURIComponent(ref);
    } catch {
      /* keep as written */
    }
    const p = joinPath(dir, ref);
    if (!p || !names.has(p)) return m;
    const href = !bang && (MD.test(p) || /\.(html?|xhtml|svg)$/i.test(p)) ? docHref(p) : rawBase(id, cap) + encodePath(p);
    return `${bang}${head}<${href}>`;
  });
}

