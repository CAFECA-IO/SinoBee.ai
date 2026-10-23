-- AlterTable
ALTER TABLE "User" ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "autoRenewCardId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "renewNoticeAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "renewAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "endReminders" INTEGER NOT NULL DEFAULT 0;
