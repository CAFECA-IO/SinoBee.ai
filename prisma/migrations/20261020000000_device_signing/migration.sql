-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'pat';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "signingKey" TEXT;

-- AlterTable
ALTER TABLE "DeviceAuth" ADD COLUMN     "signingKey" TEXT;

-- CreateTable
CREATE TABLE "RequestNonce" (
    "deviceId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestNonce_pkey" PRIMARY KEY ("deviceId","nonce")
);

-- CreateIndex
CREATE INDEX "RequestNonce_createdAt_idx" ON "RequestNonce"("createdAt");

-- Plans renamed: 低用量 → Pro, 高用量 → Ultra (only rows still carrying the original default names)
UPDATE "Plan" SET "name" = 'Pro', "nameEn" = 'Pro' WHERE "code" = 'low' AND "name" = '低用量';
UPDATE "Plan" SET "name" = 'Ultra', "nameEn" = 'Ultra' WHERE "code" = 'high' AND "name" = '高用量';
