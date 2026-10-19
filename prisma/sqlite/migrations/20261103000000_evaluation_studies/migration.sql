-- CreateTable
CREATE TABLE "EvaluationStudy" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "testedAt" DATETIME NOT NULL,
    "testedUntil" DATETIME,
    "runs" JSONB NOT NULL,
    "models" TEXT NOT NULL DEFAULT '',
    "bestModel" TEXT,
    "bestScore" REAL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationStudy_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EvaluationStudy_kind_createdAt_idx" ON "EvaluationStudy"("kind", "createdAt");
