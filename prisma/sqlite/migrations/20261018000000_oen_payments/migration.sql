-- Oen payments, subscription grace periods, published-price task billing.
-- Only ADD COLUMN / CREATE INDEX IF NOT EXISTS: no table is rebuilt, so a failed step cannot lose rows.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "billing" JSONB;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "priceBuffer" DECIMAL;
ALTER TABLE "Task" ADD COLUMN "modelPriceUsd" JSONB;
ALTER TABLE "Task" ADD COLUMN "cacheReadTokens" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "cacheWriteTokens" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'TWDC';
ALTER TABLE "Payment" ADD COLUMN "amountTwd" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "oenId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "transactionHid" TEXT;
ALTER TABLE "Payment" ADD COLUMN "checkoutUrl" TEXT;
ALTER TABLE "Payment" ADD COLUMN "checkoutExpiresAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "paidAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "planId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "buyer" JSONB;
ALTER TABLE "Payment" ADD COLUMN "refundedTwd" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "refundedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "Payment" ADD COLUMN "providerStatus" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "planId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "graceEndsAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "cancelledAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_oenId_key" ON "Payment"("oenId");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_transactionHid_key" ON "Payment"("transactionHid");
