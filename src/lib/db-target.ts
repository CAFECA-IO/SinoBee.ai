import path from "node:path";

/**
 * Database selection:
 *  - DATABASE_URL set (postgres:// or postgresql://) → PostgreSQL
 *  - otherwise → SQLite file at SQLITE_PATH (default ./data/sinobee.db)
 * Shared by prisma.config.ts, the app and the worker.
 */
export function dbTarget(env: NodeJS.ProcessEnv = process.env) {
  const url = (env.DATABASE_URL ?? "").trim();
  if (/^postgres(ql)?:\/\//.test(url)) return { kind: "postgres" as const, url };
  if (url && !url.startsWith("file:")) throw new Error(`Unsupported DATABASE_URL: use postgresql://… or leave it empty for SQLite`);
  const file = url ? url.slice("file:".length) : env.SQLITE_PATH || "./data/sinobee.db";
  return { kind: "sqlite" as const, file: path.resolve(/*turbopackIgnore: true*/ process.cwd(), file), url: `file:${path.resolve(/*turbopackIgnore: true*/ process.cwd(), file)}` };
}
