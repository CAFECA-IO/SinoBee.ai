/**
 * Seed: official publisher "cafeca" with the skills bundled in SinoBee (MIT, from CAFECA-IO/SinoBee).
 * Approved versions are signed when HUB_SIGNING_KEY is set.
 *   npm run db:seed
 */
import "dotenv/config";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { db } from "../src/lib/db";
import { config } from "../src/lib/config";
import { publishSkill } from "../src/lib/skills/service";
import { signContentHash } from "../src/lib/skills/signing";
import { compareVersions, parseSkillMd } from "../src/lib/skills/spec";
import { ensureModelPrices } from "../src/lib/models";
import { ensurePlans } from "../src/lib/plans";
import { initialRole, isAdminRole } from "../src/lib/roles";
import { generateMissing, loadSettings } from "../src/lib/settings/store";

/** A skill folder as an upload: SKILL.md alone, or a .tar.gz bundle when it has scripts, references or assets */
async function upload(dir: string, name: string): Promise<{ data: Buffer; filename: string }> {
  const entries = await readdir(dir, { recursive: true });
  if (entries.filter((e) => e !== "SKILL.md").length === 0) return { data: await readFile(path.join(dir, "SKILL.md")), filename: "SKILL.md" };
  const tmp = await mkdtemp(path.join(tmpdir(), "sb-seed-"));
  try {
    const file = path.join(tmp, `${name}.tgz`);
    await tar.c({ gzip: true, cwd: path.dirname(dir), file, portable: true, noMtime: true,
                  filter: (p) => !/(__pycache__|\.pyc$|\.DS_Store$)/.test(p) }, [name]);
    return { data: await readFile(file), filename: `${name}.tgz` };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  await loadSettings({ refreshEveryMs: 0 });
  await generateMissing();
  await ensureModelPrices();
  await ensurePlans();
  console.log("model prices and plans ready (edit them in /admin)");
  const account = (process.env.SEED_PUBLISHER_ACCOUNT ?? config.adminAccounts[0] ?? "0x00000000000000000000000000000000000cafec").toLowerCase();
  const publisher = await db.user.upsert({
    where: { account },
    create: { account, publisher: "cafeca", displayName: "CAFECA", publisherVerified: true, role: initialRole(account), isAdmin: isAdminRole(initialRole(account)) },
    update: { publisher: "cafeca", publisherVerified: true },
  });
  const dir = path.join(import.meta.dirname, "seed-skills");
  for (const name of await readdir(dir)) {
    const folder = path.join(dir, name);
    const md = await readFile(path.join(folder, "SKILL.md")).catch(() => null);
    if (!md) continue;
    const version = String(parseSkillMd(md.toString("utf8")).frontmatter.metadata?.version ?? "");
    const exists = await db.skill.findFirst({ where: { name, publisherId: publisher.id }, include: { versions: { select: { version: true } } } });
    const latest = exists?.versions.map((v) => v.version).sort(compareVersions).at(-1);
    if (latest && compareVersions(version, latest) <= 0) {
      console.log("up to date", name, latest);
      continue;
    }
    const { data, filename } = await upload(folder, name);
    const res = await publishSkill(publisher, data, filename);
    const v = await db.skillVersion.findFirstOrThrow({ where: { skill: { name, publisherId: publisher.id }, version: res.version } });
    const signature = signContentHash(v.contentHash);
    await db.skillVersion.update({
      where: { id: v.id },
      data: signature ? { status: "APPROVED", signature, reviewedAt: new Date(), reviewNote: "bundled with SinoBee" } : {},
    });
    console.log(`published cafeca/${name}@${res.version} ${signature ? "(approved & signed)" : "(pending review — set HUB_SIGNING_KEY to sign)"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
