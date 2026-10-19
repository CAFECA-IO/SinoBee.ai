-- CreateTable
CREATE TABLE "BenchEval" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "testedAt" DATETIME NOT NULL,
    "testedUntil" DATETIME,
    "trials" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "meanScore" REAL NOT NULL,
    "stdErr" REAL NOT NULL,
    "fairScore" REAL NOT NULL,
    "qualified" INTEGER NOT NULL,
    "critFails" INTEGER NOT NULL,
    "medianSeconds" REAL,
    "p90Seconds" REAL,
    "costPerPass" REAL,
    "creativityWins" INTEGER,
    "creativityTotal" INTEGER,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BenchEval_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BenchEval_kind_subject_idx" ON "BenchEval"("kind", "subject");

