-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'skill',
ADD COLUMN     "targets" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SkillVersion" ADD COLUMN     "securityReport" JSONB;

-- AlterTable
ALTER TABLE "BenchEval" ADD COLUMN     "evaluator" TEXT,
ADD COLUMN     "skillVersionId" TEXT,
ADD COLUMN     "suiteId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'public';

-- CreateTable
CREATE TABLE "BenchSuite" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'skill',
    "subject" TEXT NOT NULL,
    "subjectVersion" TEXT NOT NULL DEFAULT '',
    "skillVersionId" TEXT,
    "evaluator" TEXT NOT NULL DEFAULT '',
    "evaluatorVersion" TEXT NOT NULL DEFAULT '',
    "evaluatorSkillVersionId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "suite" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchSuite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BenchSuite_hash_key" ON "BenchSuite"("hash");

-- CreateIndex
CREATE INDEX "BenchSuite_subject_idx" ON "BenchSuite"("subject");

-- CreateIndex
CREATE INDEX "BenchEval_suiteHash_idx" ON "BenchEval"("suiteHash");

-- AddForeignKey
ALTER TABLE "BenchEval" ADD CONSTRAINT "BenchEval_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "BenchSuite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchEval" ADD CONSTRAINT "BenchEval_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "SkillVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchSuite" ADD CONSTRAINT "BenchSuite_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "SkillVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchSuite" ADD CONSTRAINT "BenchSuite_evaluatorSkillVersionId_fkey" FOREIGN KEY ("evaluatorSkillVersionId") REFERENCES "SkillVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchSuite" ADD CONSTRAINT "BenchSuite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

