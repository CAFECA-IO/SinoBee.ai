-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cardId" TEXT,
ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SavedCard" ADD COLUMN     "sandbox" BOOLEAN NOT NULL DEFAULT false;

