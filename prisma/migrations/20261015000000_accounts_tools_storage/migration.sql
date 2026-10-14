-- CreateEnum
CREATE TYPE "DeviceAuthStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "ToolVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ShareVisibility" AS ENUM ('LINK', 'LOGIN', 'PUBLIC');

-- CreateEnum
CREATE TYPE "StorageStatus" AS ENUM ('PENDING', 'STORED', 'FAILED', 'DELETED');

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "scopes" TEXT NOT NULL DEFAULT 'skills:publish';

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAuth" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "platform" TEXT,
    "ip" TEXT,
    "status" "DeviceAuthStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "interval" INTEGER NOT NULL DEFAULT 5,
    "lastPollAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'database',
    "description" TEXT NOT NULL DEFAULT '',
    "visibility" "ToolVisibility" NOT NULL DEFAULT 'PRIVATE',
    "latestVersion" TEXT,
    "installs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolVersion" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "objectKey" TEXT,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
    "scanFindings" JSONB NOT NULL DEFAULT '[]',
    "reviewNote" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "anchorCode" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultKey" (
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "wrapped" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultKey_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "VaultPack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationShare" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "visibility" "ShareVisibility" NOT NULL DEFAULT 'LINK',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "objectKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "messages" INTEGER NOT NULL,
    "model" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "anchorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareAccess" (
    "shareId" TEXT NOT NULL,
    "account" TEXT NOT NULL,

    CONSTRAINT "ShareAccess_pkey" PRIMARY KEY ("shareId","account")
);

-- CreateTable
CREATE TABLE "ShareFile" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,

    CONSTRAINT "ShareFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageObject" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "keccak" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "status" "StorageStatus" NOT NULL DEFAULT 'PENDING',
    "envelopeCid" TEXT,
    "dealRoot" TEXT,
    "dealId" BIGINT,
    "dealState" TEXT NOT NULL DEFAULT 'none',
    "blocks" INTEGER,
    "dealSize" BIGINT,
    "replicas" INTEGER,
    "endEpoch" BIGINT,
    "paidWei" TEXT,
    "txHash" TEXT,
    "recipientKey" TEXT,
    "mirrored" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextTryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Anchor" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "code" TEXT,
    "salt" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "root" TEXT,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextTryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" TIMESTAMP(3),

    CONSTRAINT "Anchor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuth_deviceCodeHash_key" ON "DeviceAuth"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuth_userCode_key" ON "DeviceAuth"("userCode");

-- CreateIndex
CREATE INDEX "Tool_visibility_updatedAt_idx" ON "Tool"("visibility", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tool_ownerId_name_key" ON "Tool"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ToolVersion_toolId_version_key" ON "ToolVersion"("toolId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "VaultPack_userId_name_key" ON "VaultPack"("userId", "name");

-- CreateIndex
CREATE INDEX "ConversationShare_ownerId_createdAt_idx" ON "ConversationShare"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationShare_visibility_createdAt_idx" ON "ConversationShare"("visibility", "createdAt");

-- CreateIndex
CREATE INDEX "ShareAccess_account_idx" ON "ShareAccess"("account");

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "StorageObject_status_nextTryAt_idx" ON "StorageObject"("status", "nextTryAt");

-- CreateIndex
CREATE INDEX "StorageObject_dealState_endEpoch_idx" ON "StorageObject"("dealState", "endEpoch");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_code_key" ON "Anchor"("code");

-- CreateIndex
CREATE INDEX "Anchor_status_nextTryAt_idx" ON "Anchor"("status", "nextTryAt");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_targetType_targetId_key" ON "Anchor"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAuth" ADD CONSTRAINT "DeviceAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tool" ADD CONSTRAINT "Tool_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolVersion" ADD CONSTRAINT "ToolVersion_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolVersion" ADD CONSTRAINT "ToolVersion_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultKey" ADD CONSTRAINT "VaultKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultPack" ADD CONSTRAINT "VaultPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationShare" ADD CONSTRAINT "ConversationShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareAccess" ADD CONSTRAINT "ShareAccess_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ConversationShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareFile" ADD CONSTRAINT "ShareFile_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ConversationShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

