-- CreateTable
CREATE TABLE IF NOT EXISTS "UsageLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "planId" TEXT,
    "deviceId" TEXT,
    "modelId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "stream" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "heldTwd" DECIMAL NOT NULL DEFAULT 0,
    "settledTwd" DECIMAL,
    "priceTwd" JSONB NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "heldOutput" INTEGER NOT NULL DEFAULT 0,
    "countedOutput" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" DATETIME,
    CONSTRAINT "UsageLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserModelStats" (
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "avgOutput" REAL NOT NULL DEFAULT 800,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "modelId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsageLedger_userId_status_idx" ON "UsageLedger"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsageLedger_userId_settledAt_idx" ON "UsageLedger"("userId", "settledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsageLedger_userId_createdAt_idx" ON "UsageLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsageLedger_status_createdAt_idx" ON "UsageLedger"("status", "createdAt");
