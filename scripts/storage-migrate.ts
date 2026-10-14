/**
 * Move objects stored before Boltchain was enabled onto Boltchain, and notarize existing skill versions.
 *
 *   npm run storage-migrate              queue every object the database references (dry run with --dry-run)
 *   npm run storage-migrate -- --anchor-skills   also notarize skill versions published before notarization
 *   npm run storage-migrate -- --run     then run keeper passes until the queue is empty (otherwise the worker does it)
 *
 * Covers skill bundles, task results (kept until their results expire), tool manifests, vault packs and
 * shares (kept until the share expires). Deleted / expired / revoked items are skipped. Idempotent.
 */
import "dotenv/config";
import { config } from "../src/lib/config";
import { db } from "../src/lib/db";
import { getObject, registerExisting } from "../src/lib/storage";
import { keeperTick, requestAnchor, storageStatus } from "../src/lib/boltchain/keeper";
import { hashFile } from "../src/lib/boltchain/certificates";

const args = new Set(process.argv.slice(2));
const dry = args.has("--dry-run");

type Item = { key: string; contentType?: string; keepUntil?: Date | null; what: string };

async function collect(): Promise<Item[]> {
  const now = new Date();
  const items: Item[] = [];
  for (const v of await db.skillVersion.findMany({ where: { status: { not: "REVOKED" } }, select: { bundleKey: true } }))
    items.push({ key: v.bundleKey, contentType: "application/gzip", what: "skill bundle" });
  for (const a of await db.artifact.findMany({ where: { deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }))
    items.push({ key: a.key, keepUntil: a.expiresAt, what: "task result" });
  for (const t of await db.toolVersion.findMany({ where: { objectKey: { not: null } }, select: { objectKey: true } }))
    items.push({ key: t.objectKey!, contentType: "application/json", what: "tool manifest" });
  for (const p of await db.vaultPack.findMany({ select: { objectKey: true } })) items.push({ key: p.objectKey, contentType: "application/json", what: "vault pack" });
  for (const s of await db.conversationShare.findMany({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, include: { files: true } })) {
    items.push({ key: s.objectKey, contentType: "application/json", keepUntil: s.expiresAt, what: "share" });
    for (const f of s.files) items.push({ key: f.objectKey, contentType: f.mime, keepUntil: s.expiresAt, what: "share file" });
  }
  return items;
}

async function main() {
  if (!config.boltchain.enabled && !dry) {
    console.error("Boltchain storage is off: set BOLT_RPC_URL, BOLT_WALLET_KEY and BOLT_MASTER_KEY (npm run swarm fills them in)");
    process.exit(1);
  }
  const items = await collect();
  const count: Record<string, Record<string, number>> = {};
  for (const it of items) {
    const r = dry ? ((await db.storageObject.findUnique({ where: { key: it.key } })) ? "tracked" : "would queue") : await registerExisting(it.key, it);
    (count[it.what] ??= {})[r] = (count[it.what][r] ?? 0) + 1;
  }
  console.table(count);

  if (args.has("--anchor-skills")) {
    let n = 0;
    const versions = await db.skillVersion.findMany({ where: { anchorCode: null, status: { in: ["PENDING_REVIEW", "APPROVED"] } } });
    for (const v of versions) {
      if (await db.anchor.findUnique({ where: { targetType_targetId: { targetType: "skill-version", targetId: v.id } } })) continue;
      if (dry) {
        n++;
        continue;
      }
      try {
        const bundle = await getObject(v.bundleKey);
        await requestAnchor("skill-version", v.id, [hashFile(bundle), hashFile(Buffer.from(v.skillMd, "utf8"))]);
        n++;
      } catch (e) {
        console.warn(`skip ${v.bundleKey}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`${dry ? "would notarize" : "queued notarization of"} ${n} skill version(s)`);
  }

  if (args.has("--run") && !dry) {
    for (let i = 0; i < 1000; i++) {
      const left = await db.storageObject.count({ where: { status: "PENDING", nextTryAt: { lte: new Date() } } });
      const anchors = await db.anchor.count({ where: { status: "pending", nextTryAt: { lte: new Date() } } });
      if (!left && !anchors) break;
      console.log(`pass ${i + 1}: ${left} object(s), ${anchors} anchor(s) waiting`);
      await keeperTick();
    }
    console.log(JSON.stringify(await storageStatus(), (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  }
  process.exit(0);
}
main();
