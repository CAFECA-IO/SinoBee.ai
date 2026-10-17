-- CreateEnum
CREATE TYPE "PledgeSource" AS ENUM ('CARD', 'POINTS', 'QUOTA');

-- CreateEnum
CREATE TYPE "PledgeStatus" AS ENUM ('ACTIVE', 'CHARGED', 'FAILED', 'CANCELLED', 'RELEASED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PUBLIC', 'BACKERS', 'AGENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskStatus" ADD VALUE 'DRAFT';
ALTER TYPE "TaskStatus" ADD VALUE 'FUNDING';
ALTER TYPE "TaskStatus" ADD VALUE 'CHARGING';
ALTER TYPE "TaskStatus" ADD VALUE 'UNFUNDED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentPurpose" ADD VALUE 'CROWD_PROPOSAL';
ALTER TYPE "PaymentPurpose" ADD VALUE 'CROWD_PLEDGE';

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'comment';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "chargeDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "crowdfund" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deadlineAt" TIMESTAMP(3),
ADD COLUMN     "durationDays" INTEGER,
ADD COLUMN     "fundedAt" TIMESTAMP(3),
ADD COLUMN     "fundingStartedAt" TIMESTAMP(3),
ADD COLUMN     "goalTwd" INTEGER,
ADD COLUMN     "proposalCreditTwd" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "proposalToBudgetTwd" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "proposalUsedTwd" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "serviceFeeRate" DECIMAL(6,4),
ADD COLUMN     "serviceFeeTwd" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "spec" JSONB,
ADD COLUMN     "specChat" JSONB,
ADD COLUMN     "specVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startEarly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Pledge" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "PledgeSource" NOT NULL,
    "shares" INTEGER NOT NULL,
    "amountTwd" INTEGER NOT NULL,
    "status" "PledgeStatus" NOT NULL DEFAULT 'ACTIVE',
    "cardId" TEXT,
    "paymentId" TEXT,
    "usageLedgerId" TEXT,
    "returnedTwd" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chargedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "tokenSealed" TEXT,
    "last4" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "SavedCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref" TEXT,
    "taskId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskInputFile" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'BACKERS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskInputFile_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "Pledge" ADD CONSTRAINT "Pledge_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pledge" ADD CONSTRAINT "Pledge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pledge" ADD CONSTRAINT "Pledge_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "SavedCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pledge" ADD CONSTRAINT "Pledge_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedCard" ADD CONSTRAINT "SavedCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointLedger" ADD CONSTRAINT "PointLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInputFile" ADD CONSTRAINT "TaskInputFile_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
