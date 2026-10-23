-- AlterTable: proposal cost absorbed for subscribed proposers (no proposal fee while subscribed)
ALTER TABLE "Task" ADD COLUMN "proposalWaivedTwd" DECIMAL NOT NULL DEFAULT 0;
