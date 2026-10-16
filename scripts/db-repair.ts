/**
 * Repair a SQLite database where `prisma migrate deploy` stopped with P3009 on
 * 20261017000000_roles_prices_plans (the first version of that migration rebuilt the User table).
 *
 *   npm run db:repair            # show what happened and what would be done
 *   npm run db:repair -- --apply # repair, then mark the migration as applied
 *
 * Steps (each one checks the current state first, so it is safe to run more than once):
 *   1. print Prisma's error log for the failed migration
 *   2. finish an interrupted User table rebuild (new_User left behind, or User renamed away) without losing rows
 *   3. create whatever the migration did not get to (tables, role column, indexes) and keep existing admins
 *   4. mark the migration as applied so the next `migrate deploy` continues
 * Back up data/sinobee.db before --apply (the script also writes a copy next to it).
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dbTarget } from "../src/lib/db-target";

const NAME = "20261017000000_roles_prices_plans";
const apply = process.argv.includes("--apply");
const t = dbTarget();
if (t.kind !== "sqlite") {
  console.log("PostgreSQL: run `npx prisma migrate resolve --rolled-back " + NAME + "` and `npx prisma migrate deploy` (that migration is transactional there).");
  process.exit(0);
}

const db = new Database(t.file);
const row = db.prepare(`SELECT * FROM _prisma_migrations WHERE migration_name = ?`).get(NAME) as
  | { finished_at: number | null; rolled_back_at: number | null; logs: string | null; started_at: number }
  | undefined;
if (!row) {
  console.log(`${NAME} has not been run on ${t.file}; nothing to repair.`);
  process.exit(0);
}
if (row.finished_at && !row.rolled_back_at) {
  console.log(`${NAME} is already applied on ${t.file}.`);
  process.exit(0);
}
console.log(`database: ${t.file}`);
console.log(`failed migration started at ${new Date(Number(row.started_at)).toISOString()}`);
console.log("---- Prisma error log ----\n" + (row.logs ?? "(empty)").slice(0, 4000) + "\n--------------------------");

const tables = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map((r) => r.name));
const cols = (tb: string) => new Set((db.prepare(`PRAGMA table_info("${tb}")`).all() as { name: string }[]).map((c) => c.name));
const plan: string[] = [];

if (!tables.has("User") && tables.has("new_User")) plan.push(`rename new_User → User (the rebuild stopped after dropping the old table)`);
else if (tables.has("User") && tables.has("new_User")) {
  const a = (db.prepare(`SELECT COUNT(*) n FROM "User"`).get() as { n: number }).n;
  const b = (db.prepare(`SELECT COUNT(*) n FROM "new_User"`).get() as { n: number }).n;
  plan.push(`drop the half-built new_User (${b} rows; User still has ${a} rows)`);
  if (b > a) {
    console.error(`new_User has more rows than User (${b} > ${a}); not touching it. Please send this output.`);
    process.exit(1);
  }
} else if (!tables.has("User")) {
  console.error("No User table at all; restore from a backup. Please send this output.");
  process.exit(1);
}
const userCols = tables.has("User") ? cols("User") : cols("new_User");
if (!userCols.has("role")) plan.push(`add User.role and give existing admins ADMIN`);
for (const tb of ["SiteSetting", "AdminAudit", "ModelPrice", "Plan"]) if (!tables.has(tb)) plan.push(`create table ${tb}`);
plan.push("create missing indexes", `mark ${NAME} as applied`);

console.log("plan:\n" + plan.map((p) => "  - " + p).join("\n"));
if (!apply) {
  console.log("\nnothing changed. Run again with --apply (npm run db:repair -- --apply).");
  process.exit(0);
}

const backup = `${t.file}.before-repair-${Date.now()}`;
db.pragma("wal_checkpoint(TRUNCATE)");
copyFileSync(t.file, backup);
console.log(`backup: ${backup}`);

const sql = readFileSync(path.resolve(import.meta.dirname, `../prisma/sqlite/migrations/${NAME}/migration.sql`), "utf8");
db.pragma("foreign_keys = OFF");
db.transaction(() => {
  if (!tables.has("User") && tables.has("new_User")) db.exec(`ALTER TABLE "new_User" RENAME TO "User"`);
  else if (tables.has("new_User")) db.exec(`DROP TABLE "new_User"`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "User_account_key" ON "User"("account")`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "User_publisher_key" ON "User"("publisher")`);
  // the migration itself is idempotent except ADD COLUMN, which we skip when the column exists
  const stmts = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean)
    .filter((s) => !(cols("User").has("role") && /ALTER TABLE "User" ADD COLUMN "role"/.test(s)) && !/^PRAGMA/i.test(s));
  for (const s of stmts) db.exec(s);
  db.prepare(`UPDATE _prisma_migrations SET finished_at = ?, rolled_back_at = NULL, applied_steps_count = 1, logs = NULL, checksum = ? WHERE migration_name = ?`).run(Date.now(), createHash("sha256").update(sql).digest("hex"), NAME);
})();
db.pragma("foreign_keys = ON");
const bad = db.prepare("PRAGMA foreign_key_check").all();
console.log(bad.length ? `warning: ${bad.length} rows reference missing rows (they existed before; see PRAGMA foreign_key_check)` : "foreign keys ok");
console.log(`repaired. Users: ${(db.prepare(`SELECT COUNT(*) n FROM "User"`).get() as { n: number }).n}. Now run: npm run swarm`);
