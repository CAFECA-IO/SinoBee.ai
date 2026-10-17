-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'SCREENING';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "category" TEXT,
ADD COLUMN     "screening" JSONB,
ADD COLUMN     "takenDownAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_crowdfund_status_deadlineAt_idx" ON "Task"("crowdfund", "status", "deadlineAt");
