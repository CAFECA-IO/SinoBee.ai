-- CreateTable
CREATE TABLE IF NOT EXISTS "SiteSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ModelPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "inputUsd" DECIMAL NOT NULL,
    "cacheReadUsd" DECIMAL NOT NULL,
    "cacheWriteUsd" DECIMAL NOT NULL,
    "outputUsd" DECIMAL NOT NULL,
    "fxRate" DECIMAL NOT NULL,
    "buffer" DECIMAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "effectiveAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "ModelPrice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "feeTwd" DECIMAL NOT NULL,
    "multiplier" DECIMAL NOT NULL,
    "maxCostTwd" DECIMAL NOT NULL,
    "l6Twd" DECIMAL NOT NULL,
    "l168Twd" DECIMAL NOT NULL,
    "concurrency" INTEGER NOT NULL DEFAULT 2,
    "days" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable
-- (ADD COLUMN instead of rebuilding the User table: no DROP TABLE, so nothing can be lost if a step fails)
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminAudit_targetType_targetId_idx" ON "AdminAudit"("targetType", "targetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ModelPrice_modelId_effectiveAt_idx" ON "ModelPrice"("modelId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Plan_code_key" ON "Plan"("code");

-- Existing admins keep their rights (no SUPERADMIN until the owner signs in or claims the site)
UPDATE "User" SET "role" = 'ADMIN' WHERE "isAdmin" = true;
