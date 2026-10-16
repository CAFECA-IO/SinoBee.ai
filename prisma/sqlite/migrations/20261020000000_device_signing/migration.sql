-- Device request signing (P5). ADD COLUMN / IF NOT EXISTS only.
ALTER TABLE "ApiToken" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'pat';
ALTER TABLE "Device" ADD COLUMN "signingKey" TEXT;
ALTER TABLE "DeviceAuth" ADD COLUMN "signingKey" TEXT;

CREATE TABLE IF NOT EXISTS "RequestNonce" (
    "deviceId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("deviceId", "nonce")
);
CREATE INDEX IF NOT EXISTS "RequestNonce_createdAt_idx" ON "RequestNonce"("createdAt");

-- Plans renamed: 低用量 → Pro, 高用量 → Ultra (only rows still carrying the original default names)
UPDATE "Plan" SET "name" = 'Pro', "nameEn" = 'Pro' WHERE "code" = 'low' AND "name" = '低用量';
UPDATE "Plan" SET "name" = 'Ultra', "nameEn" = 'Ultra' WHERE "code" = 'high' AND "name" = '高用量';
