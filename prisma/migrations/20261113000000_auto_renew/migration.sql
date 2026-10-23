-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoRenewCardId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "endReminders" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "renewAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "renewNoticeAt" TIMESTAMP(3);

