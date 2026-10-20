/**
 * Two accounts with publisher ids and SinoBee tokens, for SinoBee's end-to-end check of skill evaluations
 * (SinoBee scripts/e2e-local.sh). Development databases only: refuses to run against PostgreSQL or in production.
 *   SQLITE_PATH=/tmp/e2e.db npx tsx scripts/e2e-accounts.ts   → {"token": "sbh_…", "token2": "sbh_…"}
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "../src/lib/db";

if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL) {
  console.error("e2e-accounts: development SQLite databases only");
  process.exit(1);
}

async function token(userId: string) {
  const t = "sbh_" + randomBytes(24).toString("base64url");
  await db.apiToken.create({ data: { userId, name: "device: e2e", prefix: t.slice(0, 10), tokenHash: createHash("sha256").update(t).digest("hex"), scopes: "skills:publish tools:write vault:rw shares:write llm evals:write" } });
  return t;
}

async function main() {
  const a = await db.user.upsert({ where: { account: "0x" + "e".repeat(40) }, create: { account: "0x" + "e".repeat(40), handle: "e2e-one", publisher: "e2e-one" }, update: {} });
  const b = await db.user.upsert({ where: { account: "0x" + "f".repeat(40) }, create: { account: "0x" + "f".repeat(40), handle: "e2e-two", publisher: "e2e-two" }, update: {} });
  console.log(JSON.stringify({ token: await token(a.id), token2: await token(b.id) }));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
