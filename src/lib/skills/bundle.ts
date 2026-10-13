import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { config } from "@/lib/config";
import { parseSkillMd } from "./spec";

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv"]);
const ALLOWED_TYPES = new Set(["File", "OldFile", "ContiguousFile", "Directory"]);

export type SkillFiles = Map<string, Buffer>; // posix relative path -> bytes

export class BundleError extends Error {}

/** Same ordering as Python's sorted(Path.rglob()) — compares path parts, not raw strings */
function compareParts(a: string, b: string): number {
  const pa = a.split("/"), pb = b.split("/");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}

export const sortedPaths = (files: SkillFiles) => [...files.keys()].sort(compareParts);

/** SinoBee content hash: sha256(path \0 bytes \0 ...) over non-hidden files, "sha256:<hex>" */
export function contentHash(files: SkillFiles): string {
  const h = createHash("sha256");
  for (const p of sortedPaths(files)) {
    h.update(p);
    h.update("\0");
    h.update(files.get(p)!);
    h.update("\0");
  }
  return "sha256:" + h.digest("hex");
}

export function fileManifest(files: SkillFiles): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of sortedPaths(files)) out[p] = "sha256:" + createHash("sha256").update(files.get(p)!).digest("hex");
  return out;
}

const hidden = (rel: string) => rel.split("/").some((part) => part.startsWith(".") || SKIP_DIRS.has(part));

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, r)));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/**
 * Turn an upload (SKILL.md, .tar.gz/.tgz bundle) into { dirName, files }.
 * Enforces the Hub limits: ≤ 20 MB, ≤ 500 entries, no links/devices, no path traversal.
 */
export async function readUpload(data: Buffer, filename: string): Promise<{ dirName: string; files: SkillFiles; manifest?: unknown }> {
  if (data.length > config.hub.maxBundleBytes) throw new BundleError("bundle exceeds 20 MB");
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md")) {
    const { frontmatter } = parseSkillMd(data.toString("utf8"));
    const name = String(frontmatter.name ?? "");
    return { dirName: name, files: new Map([["SKILL.md", data]]) };
  }
  if (!/\.(tar\.gz|tgz|tar)$/.test(lower)) throw new BundleError("upload a SKILL.md or a .tar.gz bundle (sinobee skills export)");

  const tmp = await mkdtemp(path.join(tmpdir(), "sb-skill-"));
  try {
    const file = path.join(tmp, "upload.tgz");
    await writeFile(file, data);
    let count = 0;
    const problems: string[] = [];
    await tar.t({
      file,
      onReadEntry: (e) => {
        count++;
        const p = e.path.replace(/\\/g, "/");
        if (!ALLOWED_TYPES.has(e.type)) problems.push(`${p}: ${e.type} entries are not allowed`);
        if (p.startsWith("/") || p.split("/").includes("..")) problems.push(`${p}: unsafe path`);
      },
    });
    if (count > config.hub.maxFiles) throw new BundleError("too many files in bundle (max 500)");
    if (problems.length) throw new BundleError(problems.slice(0, 5).join("; "));
    const out = path.join(tmp, "x");
    await mkdir(out);
    await tar.x({ file, cwd: out, strict: true, preservePaths: false });

    // locate the skill folder (shallowest SKILL.md)
    const all = await walk(out);
    const skillMds = all.filter((p) => /(^|\/)(SKILL|skill)\.md$/.test(p)).sort((a, b) => a.split("/").length - b.split("/").length);
    if (!skillMds.length) throw new BundleError("no SKILL.md found in bundle");
    const dirRel = path.posix.dirname(skillMds[0]);
    if (skillMds.filter((p) => path.posix.dirname(p).split("/").length === dirRel.split("/").length && p !== skillMds[0]).length)
      throw new BundleError("bundle contains several skills; upload one skill per bundle");
    const root = dirRel === "." ? out : path.join(/*turbopackIgnore: true*/ out, dirRel);
    const dirName = dirRel === "." ? "" : path.posix.basename(dirRel);

    const files: SkillFiles = new Map();
    let manifest: unknown;
    for (const rel of await walk(root)) {
      if (rel === ".sinobee-manifest.json") {
        try {
          manifest = JSON.parse(await readFile(path.join(root, rel), "utf8"));
        } catch {
          /* ignore */
        }
        continue;
      }
      if (hidden(rel)) continue;
      const st = await stat(path.join(root, rel));
      if (!st.isFile()) continue;
      files.set(rel === "skill.md" ? "SKILL.md" : rel, await readFile(path.join(root, rel)));
    }
    return { dirName, files, manifest };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Build the distributable .tar.gz: a single <name>/ folder plus <name>/.sinobee-manifest.json */
export async function buildBundle(name: string, files: SkillFiles, manifest: object): Promise<Buffer> {
  const tmp = await mkdtemp(path.join(tmpdir(), "sb-bundle-"));
  try {
    const dir = path.join(tmp, name);
    for (const [rel, bytes] of files) {
      const f = path.join(dir, rel);
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, bytes);
    }
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, ".sinobee-manifest.json"), JSON.stringify(manifest, null, 2));
    const out = path.join(tmp, "bundle.tar.gz");
    await tar.c({ gzip: true, cwd: tmp, file: out, portable: true, noMtime: true }, [name]);
    return await readFile(out);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
