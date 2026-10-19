-- CreateTable
CREATE TABLE "EvaluationStudy" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT '',
    "skill" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "suite" TEXT NOT NULL,
    "judgeModel" TEXT,
    "clientVersion" TEXT,
    "testedAt" TIMESTAMP(3) NOT NULL,
    "testedUntil" TIMESTAMP(3),
    "runs" JSONB NOT NULL,
    "models" TEXT NOT NULL DEFAULT '',
    "bestModel" TEXT,
    "bestScore" DOUBLE PRECISION,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationStudy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvaluationStudy_kind_createdAt_idx" ON "EvaluationStudy"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "EvaluationStudy" ADD CONSTRAINT "EvaluationStudy_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
