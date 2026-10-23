-- CreateTable
CREATE TABLE "QuotaWeek" (
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "blockStart" TIMESTAMP(3) NOT NULL,
    "carryInTwd" DECIMAL(20,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaWeek_pkey" PRIMARY KEY ("userId","weekStart")
);

-- AddForeignKey
ALTER TABLE "QuotaWeek" ADD CONSTRAINT "QuotaWeek_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Plans on the 工時 model (2026-10-23): 30-day usage V = fee × multiplier (defaults 0.8 = buffer 1.2 ÷ margin 1.5),
-- L6 = V ÷ 22 (one 6-hour working day of the 22 in a month), weekly cap L168 = 16 × L6; weekly grant = V × 7 ÷ 30
UPDATE "Plan" SET "multiplier" = 0.8 WHERE "code" IN ('low', 'high');
UPDATE "Plan" SET "maxCostTwd" = ROUND("feeTwd" * "multiplier", 2) WHERE "code" <> 'free';
UPDATE "Plan" SET "maxCostTwd" = ROUND((SELECT p."maxCostTwd" FROM "Plan" p WHERE p."code" = 'low') / 20, 2)
  WHERE "code" = 'free' AND "maxCostTwd" = 63 AND EXISTS (SELECT 1 FROM "Plan" p WHERE p."code" = 'low');
UPDATE "Plan" SET "l6Twd" = ROUND("maxCostTwd" / 22, 2);
UPDATE "Plan" SET "l168Twd" = ROUND("l6Twd" * 16, 2);
