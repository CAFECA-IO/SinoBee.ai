-- CreateTable
CREATE TABLE "AcceptanceVote" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 0,
    "approve" BOOLEAN NOT NULL,
    "reason" TEXT,
    "shares" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("taskId", "userId", "round"),
    CONSTRAINT "AcceptanceVote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AcceptanceVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpecRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "spec" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpecRevision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "exitUntil" DATETIME,
    "stretchUnlocked" INTEGER NOT NULL DEFAULT 0,
    "topupGoalTwd" INTEGER,
    "topupDeadlineAt" DATETIME,
    "acceptance" JSONB,
    "reviewDeadlineAt" DATETIME,
    "reworks" INTEGER NOT NULL DEFAULT 0,
    "reworkNotes" TEXT,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "SkillVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("budget", "cacheReadTokens", "cacheWriteTokens", "chargeDeadlineAt", "charged", "containerName", "createdAt", "crowdfund", "deadlineAt", "durationDays", "error", "evalCriteria", "evalMethod", "finishedAt", "fundedAt", "fundingRequestedAt", "fundingStartedAt", "goalTwd", "heartbeatAt", "id", "inputTokens", "isPublic", "kind", "model", "modelPriceUsd", "outputTokens", "priceBuffer", "prompt", "proposalCreditTwd", "proposalToBudgetTwd", "proposalUsedTwd", "resultsExpireAt", "s3CostUsd", "serviceFeeRate", "serviceFeeTwd", "settledAt", "skillVersionId", "spec", "specChat", "specVersion", "startEarly", "startedAt", "status", "summary", "title", "tokenCostUsd", "updatedAt", "usdTwdRate", "userId", "vmCostUsd", "vmSeconds", "workerId") SELECT "budget", "cacheReadTokens", "cacheWriteTokens", "chargeDeadlineAt", "charged", "containerName", "createdAt", "crowdfund", "deadlineAt", "durationDays", "error", "evalCriteria", "evalMethod", "finishedAt", "fundedAt", "fundingRequestedAt", "fundingStartedAt", "goalTwd", "heartbeatAt", "id", "inputTokens", "isPublic", "kind", "model", "modelPriceUsd", "outputTokens", "priceBuffer", "prompt", "proposalCreditTwd", "proposalToBudgetTwd", "proposalUsedTwd", "resultsExpireAt", "s3CostUsd", "serviceFeeRate", "serviceFeeTwd", "settledAt", "skillVersionId", "spec", "specChat", "specVersion", "startEarly", "startedAt", "status", "summary", "title", "tokenCostUsd", "updatedAt", "usdTwdRate", "userId", "vmCostUsd", "vmSeconds", "workerId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_status_createdAt_idx" ON "Task"("status", "createdAt");
CREATE INDEX "Task_userId_createdAt_idx" ON "Task"("userId", "createdAt");
CREATE INDEX "Task_isPublic_createdAt_idx" ON "Task"("isPublic", "createdAt");
CREATE TABLE "new_Pledge" (
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
    "pointsTwd" INTEGER NOT NULL DEFAULT 0,
    "topup" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chargedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pledge_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pledge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pledge_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "SavedCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Pledge_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Pledge" ("amountTwd", "cardId", "chargedAt", "createdAt", "error", "id", "paymentId", "returnedTwd", "shares", "source", "status", "taskId", "updatedAt", "usageLedgerId", "userId") SELECT "amountTwd", "cardId", "chargedAt", "createdAt", "error", "id", "paymentId", "returnedTwd", "shares", "source", "status", "taskId", "updatedAt", "usageLedgerId", "userId" FROM "Pledge";
DROP TABLE "Pledge";
ALTER TABLE "new_Pledge" RENAME TO "Pledge";
CREATE UNIQUE INDEX "Pledge_usageLedgerId_key" ON "Pledge"("usageLedgerId");
CREATE INDEX "Pledge_taskId_status_idx" ON "Pledge"("taskId", "status");
CREATE INDEX "Pledge_userId_createdAt_idx" ON "Pledge"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SpecRevision_taskId_version_key" ON "SpecRevision"("taskId", "version");
