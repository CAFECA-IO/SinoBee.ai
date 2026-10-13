import "dotenv/config";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";
import { dbTarget } from "./src/lib/db-target";

// PostgreSQL when DATABASE_URL is set, otherwise SQLite (./data/sinobee.db or SQLITE_PATH)
const t = dbTarget();
if (t.kind === "sqlite") mkdirSync(path.dirname(t.file), { recursive: true });

export default defineConfig(
  t.kind === "postgres"
    ? {
        schema: "prisma/schema.prisma",
        migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
        datasource: { url: t.url },
      }
    : {
        schema: "prisma/sqlite/schema.prisma",
        migrations: { path: "prisma/sqlite/migrations", seed: "tsx prisma/seed.ts" },
        datasource: { url: t.url },
      },
);
