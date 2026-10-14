import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Fresh migrated SQLite database for one test file. Call before importing anything that uses `db`. */
export function useTestDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sbai-test-"));
  const file = path.join(dir, "test.db");
  delete process.env.DATABASE_URL;
  process.env.SQLITE_PATH = file;
  execSync("npx prisma migrate deploy", { env: { ...process.env, SQLITE_PATH: file, DATABASE_URL: "" }, stdio: "ignore" });
  return { dir, file };
}
