-- CreateEnum
CREATE TYPE "UsageStatus" AS ENUM ('HELD', 'SETTLED', 'ESTIMATED', 'EXPIRED', 'REFUNDED');

-- CreateTable
CREATE TABLE "UsageLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "planId" TEXT,
    "deviceId" TEXT,
    "modelId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "stream" BOOLEAN NOT NULL DEFAULT false,
    "status" "UsageStatus" NOT NULL DEFAULT 'HELD',
    "heldTwd" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "settledTwd" DECIMAL(20,6),
    "priceTwd" JSONB NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "heldOutput" INTEGER NOT NULL DEFAULT 0,
    "countedOutput" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserModelStats" (
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "avgOutput" DOUBLE PRECISION NOT NULL DEFAULT 800,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserModelStats_pkey" PRIMARY KEY ("userId","modelId")
);

-- CreateIndex
CREATE INDEX "UsageLedger_userId_status_idx" ON "UsageLedger"("userId", "status");

-- CreateIndex
CREATE INDEX "UsageLedger_userId_settledAt_idx" ON "UsageLedger"("userId", "settledAt");

-- CreateIndex
CREATE INDEX "UsageLedger_userId_createdAt_idx" ON "UsageLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLedger_status_createdAt_idx" ON "UsageLedger"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
