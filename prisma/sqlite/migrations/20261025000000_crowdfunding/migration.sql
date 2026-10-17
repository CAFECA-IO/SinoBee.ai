-- CreateTable
CREATE TABLE "Pledge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "amountTwd" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cardId" TEXT,
    "paymentId" TEXT,
    "usageLedgerId" TEXT,
    "returnedTwd" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chargedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pledge_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pledge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pledge_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "SavedCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Pledge_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "tokenSealed" TEXT,
    "last4" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" DATETIME,
    "removedAt" DATETIME,
    CONSTRAINT "SavedCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref" TEXT,
    "taskId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskInputFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'BACKERS',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "TaskInputFile_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Comment" ("body", "createdAt", "deletedAt", "id", "parentId", "targetId", "targetType", "userId") SELECT "body", "createdAt", "deletedAt", "id", "parentId", "targetId", "targetType", "userId" FROM "Comment";
DROP TABLE "Comment";
ALTER TABLE "new_Comment" RENAME TO "Comment";
CREATE INDEX "Comment_targetType_targetId_createdAt_idx" ON "Comment"("targetType", "targetId", "createdAt");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TASK',
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "skillVersionId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "budget" DECIMAL NOT NULL DEFAULT 0,
    "charged" DECIMAL NOT NULL DEFAULT 0,
    "usdTwdRate" DECIMAL NOT NULL DEFAULT 32,
    "priceBuffer" DECIMAL,
    "modelPriceUsd" JSONB,
    "cacheReadTokens" BIGINT NOT NULL DEFAULT 0,
    "cacheWriteTokens" BIGINT NOT NULL DEFAULT 0,
    "tokenCostUsd" DECIMAL NOT NULL DEFAULT 0,
    "vmCostUsd" DECIMAL NOT NULL DEFAULT 0,
    "s3CostUsd" DECIMAL NOT NULL DEFAULT 0,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "vmSeconds" INTEGER NOT NULL DEFAULT 0,
    "evalMethod" TEXT,
    "evalCriteria" TEXT,
    "summary" TEXT,
    "error" TEXT,
    "containerName" TEXT,
    "workerId" TEXT,
    "heartbeatAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "fundingRequestedAt" DATETIME,
    "resultsExpireAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "crowdfund" BOOLEAN NOT NULL DEFAULT false,
    "goalTwd" INTEGER,
    "durationDays" INTEGER,
    "deadlineAt" DATETIME,
    "startEarly" BOOLEAN NOT NULL DEFAULT false,
    "serviceFeeRate" DECIMAL,
    "serviceFeeTwd" INTEGER NOT NULL DEFAULT 0,
    "spec" JSONB,
    "specVersion" INTEGER NOT NULL DEFAULT 0,
    "specChat" JSONB,
    "proposalCreditTwd" DECIMAL NOT NULL DEFAULT 0,
    "proposalUsedTwd" DECIMAL NOT NULL DEFAULT 0,
    "proposalToBudgetTwd" DECIMAL NOT NULL DEFAULT 0,
    "fundingStartedAt" DATETIME,
    "fundedAt" DATETIME,
    "chargeDeadlineAt" DATETIME,
    "settledAt" DATETIME,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "SkillVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("budget", "cacheReadTokens", "cacheWriteTokens", "charged", "containerName", "createdAt", "error", "evalCriteria", "evalMethod", "finishedAt", "fundingRequestedAt", "heartbeatAt", "id", "inputTokens", "isPublic", "kind", "model", "modelPriceUsd", "outputTokens", "priceBuffer", "prompt", "resultsExpireAt", "s3CostUsd", "skillVersionId", "startedAt", "status", "summary", "title", "tokenCostUsd", "updatedAt", "usdTwdRate", "userId", "vmCostUsd", "vmSeconds", "workerId") SELECT "budget", "cacheReadTokens", "cacheWriteTokens", "charged", "containerName", "createdAt", "error", "evalCriteria", "evalMethod", "finishedAt", "fundingRequestedAt", "heartbeatAt", "id", "inputTokens", "isPublic", "kind", "model", "modelPriceUsd", "outputTokens", "priceBuffer", "prompt", "resultsExpireAt", "s3CostUsd", "skillVersionId", "startedAt", "status", "summary", "title", "tokenCostUsd", "updatedAt", "usdTwdRate", "userId", "vmCostUsd", "vmSeconds", "workerId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_status_createdAt_idx" ON "Task"("status", "createdAt");
CREATE INDEX "Task_userId_createdAt_idx" ON "Task"("userId", "createdAt");
CREATE INDEX "Task_isPublic_createdAt_idx" ON "Task"("isPublic", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Pledge_usageLedgerId_key" ON "Pledge"("usageLedgerId");

-- CreateIndex
CREATE INDEX "Pledge_taskId_status_idx" ON "Pledge"("taskId", "status");

-- CreateIndex
CREATE INDEX "Pledge_userId_createdAt_idx" ON "Pledge"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedCard_bindingId_key" ON "SavedCard"("bindingId");

-- CreateIndex
CREATE INDEX "SavedCard_userId_status_idx" ON "SavedCard"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PointLedger_ref_key" ON "PointLedger"("ref");

-- CreateIndex
CREATE INDEX "PointLedger_userId_createdAt_idx" ON "PointLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskInputFile_taskId_idx" ON "TaskInputFile"("taskId");
