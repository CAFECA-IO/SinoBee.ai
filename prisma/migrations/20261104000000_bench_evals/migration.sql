-- CreateTable
CREATE TABLE "BenchEval" (
    "id" SERIAL NOT NULL,
    "publisherId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectVersion" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "suite" TEXT NOT NULL,
    "suiteHash" TEXT NOT NULL,
    "inputHash" TEXT,
    "thinkingModel" TEXT NOT NULL,
    "executionModel" TEXT NOT NULL,
    "judgeModel" TEXT NOT NULL,
    "judge2Model" TEXT,
    "clientVersion" TEXT,
    "testedAt" TIMESTAMP(3) NOT NULL,
    "testedUntil" TIMESTAMP(3),
    "trials" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "meanScore" DOUBLE PRECISION NOT NULL,
    "stdErr" DOUBLE PRECISION NOT NULL,
    "fairScore" DOUBLE PRECISION NOT NULL,
    "qualified" INTEGER NOT NULL,
    "critFails" INTEGER NOT NULL,
    "medianSeconds" DOUBLE PRECISION,
    "p90Seconds" DOUBLE PRECISION,
    "costPerPass" DOUBLE PRECISION,
    "creativityWins" INTEGER,
    "creativityTotal" INTEGER,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchEval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BenchEval_kind_subject_idx" ON "BenchEval"("kind", "subject");

-- AddForeignKey
ALTER TABLE "BenchEval" ADD CONSTRAINT "BenchEval_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

