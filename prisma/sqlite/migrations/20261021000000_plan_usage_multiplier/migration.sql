-- Plan.multiplier changes meaning: it was fee ÷ max cost, it is now max usage ÷ fee.
-- The untouched default plans move to the new defaults (Pro 1.5×, Ultra 5×); any other plan is inverted,
-- which keeps its current limits exactly. Limits are then recomputed from fee × multiplier.
UPDATE "Plan" SET "multiplier" = CASE
    WHEN "code" = 'low' AND "multiplier" = 3 THEN 1.5
    WHEN "code" = 'high' AND "multiplier" = 1.5 THEN 5
    ELSE ROUND(1.0 / "multiplier", 4)
  END
WHERE "multiplier" > 0;

UPDATE "Plan" SET
  "maxCostTwd" = ROUND("feeTwd" * "multiplier", 2),
  "l168Twd" = ROUND("feeTwd" * "multiplier" / 4.8, 2),
  "l6Twd" = ROUND("feeTwd" * "multiplier" / 48.0, 2);
