/**
 * Copy the skills bundled with SinoBee into prisma/seed-skills (the official "cafeca" publisher's skills).
 *   npm run seed:sync                     # from ../SinoBee
 *   SINOBEE_REPO=/path/to/SinoBee npm run seed:sync
 * Then `npm run db:seed` publishes new skills and new versions (metadata.version must be bumped).
 */
import { cp, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const repo = path.resolve(process.env.SINOBEE_REPO ?? path.join(import.meta.dirname, "..", "..", "SinoBee"));
const src = path.join(repo, "sinobee", "bundled_skills");
const dst = path.join(import.meta.dirname, "..", "prisma", "seed-skills");

async function main() {
  if (!(await stat(src).catch(() => null))?.isDirectory()) throw new Error(`no bundled skills at ${src} (set SINOBEE_REPO)`);
  for (const name of await readdir(src)) {
    const from = path.join(src, name);
    if (!(await stat(path.join(from, "SKILL.md")).catch(() => null))) continue;
    await rm(path.join(dst, name), { recursive: true, force: true });
    await cp(from, path.join(dst, name), {
      recursive: true,
      filter: (p) => !/(__pycache__|\.pyc$|\.DS_Store$)/.test(p),
    });
    console.log("synced", name);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
