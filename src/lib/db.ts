import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaClient as SqliteClient } from "@/generated/sqlite/client";
import { dbTarget } from "./db-target";

/**
 * PostgreSQL when DATABASE_URL is set, otherwise SQLite.
 * Both clients are generated from the same models (prisma/sqlite/schema.prisma is derived from
 * prisma/schema.prisma), so the SQLite client is exposed with the PostgreSQL client's type.
 */
const g = globalThis as unknown as { __prisma?: PrismaClient };

export const dbKind = dbTarget().kind;

function create(): PrismaClient {
  const t = dbTarget();
  if (t.kind === "postgres") return new PrismaClient({ adapter: new PrismaPg({ connectionString: t.url }) });
  mkdirSync(path.dirname(t.file), { recursive: true });
  return new SqliteClient({ adapter: new PrismaBetterSqlite3({ url: t.url }) }) as unknown as PrismaClient;
}

export const db = g.__prisma ?? create();
if (process.env.NODE_ENV !== "production") g.__prisma = db;

/** case-insensitive `contains` (SQLite LIKE is already case-insensitive for ASCII and rejects `mode`) */
export const icontains = (q: string) => (dbKind === "postgres" ? { contains: q, mode: "insensitive" as const } : { contains: q });
