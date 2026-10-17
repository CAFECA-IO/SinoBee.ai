-- AlterTable
ALTER TABLE "Task" ADD COLUMN "category" TEXT;
ALTER TABLE "Task" ADD COLUMN "screening" JSONB;
ALTER TABLE "Task" ADD COLUMN "takenDownAt" DATETIME;

-- CreateIndex
CREATE INDEX "Task_crowdfund_status_deadlineAt_idx" ON "Task"("crowdfund", "status", "deadlineAt");
