/**
 * Seed: official publisher "cafeca" with the skills bundled in SinoBee (MIT, from CAFECA-IO/SinoBee).
 * Approved versions are signed when HUB_SIGNING_KEY is set.
 *   npm run db:seed
 */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";
import { config } from "../src/lib/config";
import { publishSkill } from "../src/lib/skills/service";
import { signContentHash } from "../src/lib/skills/signing";

async function main() {
  const account = (process.env.SEED_PUBLISHER_ACCOUNT ?? config.adminAccounts[0] ?? "0x00000000000000000000000000000000000cafec").toLowerCase();
  const publisher = await db.user.upsert({
    where: { account },
    create: { account, publisher: "cafeca", displayName: "CAFECA", publisherVerified: true, isAdmin: config.adminAccounts.includes(account) },
    update: { publisher: "cafeca", publisherVerified: true },
  });
  const dir = path.join(import.meta.dirname, "seed-skills");
  for (const name of await readdir(dir)) {
    const md = await readFile(path.join(dir, name, "SKILL.md"));
    const exists = await db.skill.findFirst({ where: { name, publisherId: publisher.id } });
    if (exists) {
      console.log("skip", name);
      continue;
    }
    const res = await publishSkill(publisher, md, "SKILL.md");
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
