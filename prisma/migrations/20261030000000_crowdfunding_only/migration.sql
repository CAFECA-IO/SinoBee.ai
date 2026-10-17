-- Commissioned tasks were removed before launch: nothing should match these, but never leave values the new enums lack
UPDATE "Task" SET "status" = 'CANCELLED' WHERE "status" = 'AWAITING_PAYMENT';
DELETE FROM "Payment" WHERE "purpose" IN ('TASK_BUDGET', 'TASK_TOPUP');

-- AlterEnum
BEGIN;
CREATE TYPE "TaskStatus_new" AS ENUM ('DRAFT', 'SCREENING', 'FUNDING', 'CHARGING', 'UNFUNDED', 'IN_REVIEW', 'DISPUTED', 'QUEUED', 'RUNNING', 'NEEDS_FUNDING', 'COMPLETED', 'FAILED', 'CANCELLED');
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus_new" USING ("status"::text::"TaskStatus_new");
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";
DROP TYPE "TaskStatus_old";
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentPurpose_new" AS ENUM ('CROWD_PROPOSAL', 'CROWD_PLEDGE', 'SUBSCRIPTION');
ALTER TABLE "Payment" ALTER COLUMN "purpose" TYPE "PaymentPurpose_new" USING ("purpose"::text::"PaymentPurpose_new");
ALTER TYPE "PaymentPurpose" RENAME TO "PaymentPurpose_old";
ALTER TYPE "PaymentPurpose_new" RENAME TO "PaymentPurpose";
DROP TYPE "PaymentPurpose_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "TaskVote" DROP CONSTRAINT "TaskVote_taskId_fkey";

-- DropForeignKey
ALTER TABLE "TaskVote" DROP CONSTRAINT "TaskVote_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserContainer" DROP CONSTRAINT "UserContainer_userId_fkey";

-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'DRAFT',
ALTER COLUMN "crowdfund" SET DEFAULT true;

-- DropTable
DROP TABLE "TaskVote";

-- DropTable
DROP TABLE "UserContainer";

