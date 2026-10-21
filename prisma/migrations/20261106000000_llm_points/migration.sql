-- AlterTable
ALTER TABLE "UsageLedger" ADD COLUMN     "billing" TEXT NOT NULL DEFAULT 'subscription';

-- CreateIndex
CREATE INDEX "UsageLedger_userId_billing_status_idx" ON "UsageLedger"("userId", "billing", "status");
