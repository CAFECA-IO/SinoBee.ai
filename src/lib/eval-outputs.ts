/**
 * What a trial produced, shown in its report next to the verdicts (design draft 2026-10-21, R2).
 *
 * SinoBee uploads every output file by its sha256 (PUT /api/v1/evals/outputs/<sha256>) and lists it in the report
 * with that hash: the file shown is the file the judge read. An HTML output is served as ONE self-contained page for
 * `<iframe sandbox="allow-scripts" srcdoc>` - the trial's own images, scripts and styles inlined, a CSP without
 * network, and a small finder that marks the judge's quote. The same page is built by SinoBee
 * (sinobee/evals/outputs.py) for its local panel.
 */
import { createHash } from "node:crypto";
import { getObject, putObject } from "@/lib/storage";
import { HttpError } from "@/lib/errors";
import type { EvalTask } from "@/lib/bench-evals";

export const OUTPUT_MAX = 3_500_000;            // one file (SinoBee keeps text <= 300 KB, images <= 3 MB)
export const INLINE_MAX = 3_000_000;
export const outputKey = (sha: string) => `evals/outputs/${sha}`;
export const isSha = (s: string | null | undefined): s is string => !!s && /^[0-9a-f]{64}$/.test(s);
export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; "
  + "font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

const FINDER = `<script>(function(){var last=null;function clear(){if(last&&last.parentNode){var t=document.createTextNode(last.textContent);last.parentNode.replaceChild(t,last);t.parentNode.normalize();}last=null;}
function norm(s){return String(s||'').replace(/\\s+/g,' ').trim();}
window.addEventListener('message',function(e){var d=e.data||{};if(typeof d.sinobeeFind!=='string')return;clear();var q=norm(d.sinobeeFind);if(!q||!document.body)return;
var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),n,found=false;while((n=w.nextNode())){var i=n.nodeValue.indexOf(q.slice(0,40));if(i<0)continue;
var r=document.createRange();r.setStart(n,i);r.setEnd(n,Math.min(n.nodeValue.length,i+q.length));var m=document.createElement('mark');m.style.cssText='background:#ffe58a;color:#000;outline:2px solid #f5a623';
try{r.surroundContents(m);last=m;m.scrollIntoView({block:'center',behavior:'smooth'});found=true;}catch(x){}break;}
parent.postMessage({sinobeeFound:found},'*');});})();</script>`;

export type OutKind = "html" | "image" | "svg" | "markdown" | "csv" | "text" | "other";
const TEXT_EXT = new Set([".md", ".txt", ".html", ".htm", ".json", ".csv", ".py", ".js", ".ts", ".css", ".svg", ".yaml", ".yml"]);
const IMG: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };
const ext = (p: string) => (p.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "").toLowerCase();

export function kindOf(path: string): OutKind {
  const e = ext(path);
  if (e === ".html" || e === ".htm") return "html";
  if (e === ".svg") return "svg";
  if (IMG[e]) return "image";
  if (e === ".md") return "markdown";
  if (e === ".csv") return "csv";
  return TEXT_EXT.has(e) ? "text" : "other";
}

/** The content type a file is served with on its own: images as images, everything else as plain text (a page runs only in the sandbox) */
export const serveType = (path: string) => IMG[ext(path)] ?? "text/plain; charset=utf-8";

/** The files of one trial of one input: path -> sha256 (uploaded ones only) */
export function trialFiles(tasks: EvalTask[], taskId: string, trial: number): Map<string, string> {
  const t = tasks.find((x) => x.id === taskId)?.trials.find((x) => x.trial === trial);
  const out = new Map<string, string>();
  for (const o of t?.outputs ?? []) if (o.sha256 && o.uploaded) out.set(o.path, o.sha256);
  return out;
}

/** Every hash a report lists as uploaded: what its pages may serve */
export function reportHashes(tasks: EvalTask[]): Set<string> {
  const s = new Set<string>();
  for (const t of tasks) for (const x of t.trials) for (const o of [...(x.outputs ?? []), ...(x.shots ?? [])]) if (o.sha256 && o.uploaded) s.add(o.sha256);
  return s;
}

const isLocal = (ref: string) => !!ref && !/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(ref);

/** `rel` resolved against the folder of `page`, kept inside the trial (no "..", no absolute path) */
export function resolveRel(page: string, ref: string): string | null {
  if (!isLocal(ref)) return null;
  const clean = ref.split("#")[0].split("?")[0];
  const parts = [...page.split("/").slice(0, -1), ...clean.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") { if (!out.length) return null; out.pop(); continue; }
    out.push(p);
  }
  return out.join("/");
}

/** The HTML output `path` as one page for a sandboxed srcdoc frame (assets of the same trial inlined) */
export async function buildPage(files: Map<string, string>, path: string, read: (sha: string) => Promise<Buffer> = (s) => getObject(outputKey(s))): Promise<string> {
  const sha = files.get(path);
  if (!sha) throw new Error("not uploaded");
  let html = (await read(sha)).toString("utf8");
  const load = async (ref: string) => {
    const p = resolveRel(path, ref);
    const s = p ? files.get(p) : undefined;
    return s && p ? { p, b: await read(s) } : null;
  };
  const swaps: [string, string][] = [];
  for (const m of html.matchAll(/<script\b([^>]*?)\s+src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi)) {
    const f = await load(m[2]);
    if (f) swaps.push([m[0], `<script${m[1]}${m[3]}>${f.b.toString("utf8").replace(/<\/script/gi, "<\\/script")}</script>`]);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']?stylesheet/i.test(m[0])) continue;
    const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
    const f = href ? await load(href) : null;
    if (f) swaps.push([m[0], `<style>${f.b.toString("utf8")}</style>`]);
  }
  for (const m of html.matchAll(/\b(src|poster)=(["'])([^"']+)\2/gi)) {
    if (/^(data:|https?:|\/\/)/i.test(m[3])) continue;
    const f = await load(m[3]);
    if (f && f.b.length <= INLINE_MAX) swaps.push([m[0], `${m[1]}=${m[2]}data:${IMG[ext(f.p)] ?? "application/octet-stream"};base64,${f.b.toString("base64")}${m[2]}`]);
  }
  for (const [a, b] of swaps) html = html.replace(a, () => b);
  const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/(<head[^>]*>)/i, (h) => h + head) : head + html;
  return html + FINDER;
}

export async function storeOutput(sha: string, body: Buffer) {
  if (sha256(body) !== sha) throw new HttpError(400, "sha256 does not match the body");
  await putObject(outputKey(sha), body, "application/octet-stream");
}
