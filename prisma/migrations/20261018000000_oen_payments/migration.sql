-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('TWDC', 'OEN', 'MOCK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billing" JSONB;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "cacheReadTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "cacheWriteTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "modelPriceUsd" JSONB,
ADD COLUMN     "priceBuffer" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "amountTwd" INTEGER,
ADD COLUMN     "buyer" JSONB,
ADD COLUMN     "checkoutExpiresAt" TIMESTAMP(3),
ADD COLUMN     "checkoutUrl" TEXT,
ADD COLUMN     "oenId" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'TWDC',
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedTwd" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transactionHid" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "planId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_oenId_key" ON "Payment"("oenId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transactionHid_key" ON "Payment"("transactionHid");
