-- CreateTable
CREATE TABLE "RouteStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "taskKind" TEXT NOT NULL DEFAULT 'other',
    "skill" TEXT,
    "outcome" TEXT NOT NULL,
    "seconds" REAL NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "cutOff" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "RouteStat_modelId_taskKind_idx" ON "RouteStat"("modelId", "taskKind");

-- CreateIndex
CREATE INDEX "RouteStat_day_idx" ON "RouteStat"("day");
