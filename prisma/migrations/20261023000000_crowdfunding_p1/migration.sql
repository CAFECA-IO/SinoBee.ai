-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskStatus" ADD VALUE 'IN_REVIEW';
ALTER TYPE "TaskStatus" ADD VALUE 'DISPUTED';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "acceptance" JSONB,
ADD COLUMN     "exitUntil" TIMESTAMP(3),
ADD COLUMN     "reviewDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "reworkNotes" TEXT,
ADD COLUMN     "reworks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stretchUnlocked" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "topupDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "topupGoalTwd" INTEGER;

-- AlterTable
ALTER TABLE "Pledge" ADD COLUMN     "pointsTwd" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "topup" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AcceptanceVote" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 0,
    "approve" BOOLEAN NOT NULL,
    "reason" TEXT,
    "shares" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcceptanceVote_pkey" PRIMARY KEY ("taskId","userId","round")
);

-- CreateTable
CREATE TABLE "SpecRevision" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "spec" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpecRevision_taskId_version_key" ON "SpecRevision"("taskId", "version");

-- AddForeignKey
ALTER TABLE "AcceptanceVote" ADD CONSTRAINT "AcceptanceVote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceVote" ADD CONSTRAINT "AcceptanceVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecRevision" ADD CONSTRAINT "SpecRevision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
