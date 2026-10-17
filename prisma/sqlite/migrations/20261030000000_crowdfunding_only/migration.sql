-- Commissioned tasks were removed before launch: nothing should match these, but never leave values the new enums lack
UPDATE "Task" SET "status" = 'CANCELLED' WHERE "status" = 'AWAITING_PAYMENT';
DELETE FROM "Payment" WHERE "purpose" IN ('TASK_BUDGET', 'TASK_TOPUP');

-- DropIndex
DROP INDEX "UserContainer_containerName_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "TaskVote";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "UserContainer";
PRAGMA foreign_keys=on;

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
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
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
    "crowdfund" BOOLEAN NOT NULL DEFAULT true,
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
    "category" TEXT,
    "screening" JSONB,
    "takenDownAt" DATETIME,
    "screenAt" DATETIME,
    "termsVersion" INTEGER,
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
INSERT INTO "new_Task" ("acceptance", "budget", "cacheReadTokens", "cacheWriteTokens", "category", "chargeDeadlineAt", "charged", "containerName", "createdAt", "crowdfund", "deadlineAt", "durationDays", "error", "evalCriteria", "evalMethod", "exitUntil", "finishedAt", "fundedAt", "fundingRequestedAt", "fundingStartedAt", "goalTwd", "heartbeatAt", "id", "inputTokens", "isPublic", "kind", "model", "modelPriceUsd", "outputTokens", "priceBuffer", "prompt", "proposalCreditTwd", "proposalToBudgetTwd", "proposalUsedTwd", "resultsExpireAt", "reviewDeadlineAt", "reworkNotes", "reworks", "s3CostUsd", "screenAt", "screening", "serviceFeeRate", "serviceFeeTwd", "settledAt", "skillVersionId", "spec", "specChat", "specVersion", "startEarly", "startedAt", "status", "stretchUnlocked", "summary", "takenDownAt", "termsVersion", "title", "tokenCostUsd", "topupDeadlineAt", "topupGoalTwd", "updatedAt", "usdTwdRate", "userId", "vmCostUsd", "vmSeconds", "workerId") SELECT "acceptance", "budget", "cacheReadTokens", "cacheWriteTokens", "category", "chargeDeadlineAt", "charged", "containerName", "createdAt", "crowdfund", "deadlineAt", "durationDays", "error", "evalCriteria", "evalMethod", "exitUntil", "finishedAt", "fundedAt", "fundingRequestedAt", "fundingStartedAt", "goalTwd", "heartbeatAt", "id", "inputTokens", "isPublic", "kind", "model", "modelPriceUsd", "outputTokens", "priceBuffer", "prompt", "proposalCreditTwd", "proposalToBudgetTwd", "proposalUsedTwd", "resultsExpireAt", "reviewDeadlineAt", "reworkNotes", "reworks", "s3CostUsd", "screenAt", "screening", "serviceFeeRate", "serviceFeeTwd", "settledAt", "skillVersionId", "spec", "specChat", "specVersion", "startEarly", "startedAt", "status", "stretchUnlocked", "summary", "takenDownAt", "termsVersion", "title", "tokenCostUsd", "topupDeadlineAt", "topupGoalTwd", "updatedAt", "usdTwdRate", "userId", "vmCostUsd", "vmSeconds", "workerId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_status_createdAt_idx" ON "Task"("status", "createdAt");
CREATE INDEX "Task_userId_createdAt_idx" ON "Task"("userId", "createdAt");
CREATE INDEX "Task_isPublic_createdAt_idx" ON "Task"("isPublic", "createdAt");
CREATE INDEX "Task_crowdfund_status_deadlineAt_idx" ON "Task"("crowdfund", "status", "deadlineAt");
CREATE INDEX "Task_status_screenAt_idx" ON "Task"("status", "screenAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

