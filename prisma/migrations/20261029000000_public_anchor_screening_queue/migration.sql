-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "screenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Anchor" ADD COLUMN     "publicFiles" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Task_status_screenAt_idx" ON "Task"("status", "screenAt");

