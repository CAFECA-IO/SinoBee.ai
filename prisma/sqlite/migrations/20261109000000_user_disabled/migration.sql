-- AlterTable
ALTER TABLE "User" ADD COLUMN "disabledAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "disabledReason" TEXT;
