-- AlterTable
ALTER TABLE "SkillVersion" ADD COLUMN "securityReport" JSONB;

-- CreateTable
CREATE TABLE "BenchSuite" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BenchSuite_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "SkillVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BenchSuite_evaluatorSkillVersionId_fkey" FOREIGN KEY ("evaluatorSkillVersionId") REFERENCES "SkillVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BenchSuite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publisherId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "license" TEXT,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "ratingAvg" REAL NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "latestVersion" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'skill',
    "targets" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Skill_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Skill" ("createdAt", "description", "downloads", "id", "latestVersion", "license", "name", "publisherId", "ratingAvg", "ratingCount", "updatedAt") SELECT "createdAt", "description", "downloads", "id", "latestVersion", "license", "name", "publisherId", "ratingAvg", "ratingCount", "updatedAt" FROM "Skill";
DROP TABLE "Skill";
ALTER TABLE "new_Skill" RENAME TO "Skill";
CREATE INDEX "Skill_downloads_idx" ON "Skill"("downloads");
CREATE UNIQUE INDEX "Skill_publisherId_name_key" ON "Skill"("publisherId", "name");
CREATE TABLE "new_BenchEval" (
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
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "evaluator" TEXT,
    "suiteId" TEXT,
    "skillVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BenchEval_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BenchEval_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "BenchSuite" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BenchEval_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "SkillVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BenchEval" ("clientVersion", "costPerPass", "createdAt", "creativityTotal", "creativityWins", "critFails", "data", "executionModel", "fairScore", "hidden", "id", "inputHash", "judge2Model", "judgeModel", "kind", "meanScore", "medianSeconds", "p90Seconds", "publisherId", "qualified", "stdErr", "subject", "subjectVersion", "suite", "suiteHash", "summary", "testedAt", "testedUntil", "thinkingModel", "title", "trials") SELECT "clientVersion", "costPerPass", "createdAt", "creativityTotal", "creativityWins", "critFails", "data", "executionModel", "fairScore", "hidden", "id", "inputHash", "judge2Model", "judgeModel", "kind", "meanScore", "medianSeconds", "p90Seconds", "publisherId", "qualified", "stdErr", "subject", "subjectVersion", "suite", "suiteHash", "summary", "testedAt", "testedUntil", "thinkingModel", "title", "trials" FROM "BenchEval";
DROP TABLE "BenchEval";
ALTER TABLE "new_BenchEval" RENAME TO "BenchEval";
CREATE INDEX "BenchEval_kind_subject_idx" ON "BenchEval"("kind", "subject");
CREATE INDEX "BenchEval_suiteHash_idx" ON "BenchEval"("suiteHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BenchSuite_hash_key" ON "BenchSuite"("hash");

-- CreateIndex
CREATE INDEX "BenchSuite_subject_idx" ON "BenchSuite"("subject");

