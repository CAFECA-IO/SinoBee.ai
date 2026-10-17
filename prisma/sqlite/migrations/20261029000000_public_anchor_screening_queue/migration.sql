-- AlterTable
ALTER TABLE "Task" ADD COLUMN "screenAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Anchor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "code" TEXT,
    "salt" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "publicFiles" BOOLEAN NOT NULL DEFAULT false,
    "root" TEXT,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextTryAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" DATETIME
);
INSERT INTO "new_Anchor" ("attempts", "code", "createdAt", "error", "files", "id", "issuedAt", "nextTryAt", "root", "salt", "status", "targetId", "targetType", "txHash") SELECT "attempts", "code", "createdAt", "error", "files", "id", "issuedAt", "nextTryAt", "root", "salt", "status", "targetId", "targetType", "txHash" FROM "Anchor";
DROP TABLE "Anchor";
ALTER TABLE "new_Anchor" RENAME TO "Anchor";
CREATE UNIQUE INDEX "Anchor_code_key" ON "Anchor"("code");
CREATE INDEX "Anchor_status_nextTryAt_idx" ON "Anchor"("status", "nextTryAt");
CREATE UNIQUE INDEX "Anchor_targetType_targetId_key" ON "Anchor"("targetType", "targetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Task_status_screenAt_idx" ON "Task"("status", "screenAt");

