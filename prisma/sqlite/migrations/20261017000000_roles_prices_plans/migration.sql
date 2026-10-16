-- CreateTable
CREATE TABLE "SiteSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AdminAudit" (
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
CREATE TABLE "ModelPrice" (
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
CREATE TABLE "Plan" (
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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account" TEXT NOT NULL,
    "handle" TEXT,
    "publisher" TEXT,
    "displayName" TEXT,
    "kycLevel" INTEGER,
    "publisherVerified" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("account", "createdAt", "displayName", "handle", "id", "isAdmin", "kycLevel", "lastLoginAt", "publisher", "publisherVerified") SELECT "account", "createdAt", "displayName", "handle", "id", "isAdmin", "kycLevel", "lastLoginAt", "publisher", "publisherVerified" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_account_key" ON "User"("account");
CREATE UNIQUE INDEX "User_publisher_key" ON "User"("publisher");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAudit_targetType_targetId_idx" ON "AdminAudit"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ModelPrice_modelId_effectiveAt_idx" ON "ModelPrice"("modelId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- Existing admins keep their rights (no SUPERADMIN until the owner signs in or claims the site)
UPDATE "User" SET "role" = 'ADMIN' WHERE "isAdmin" = true;
