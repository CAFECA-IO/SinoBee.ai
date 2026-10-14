-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "publicKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeviceAuth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "platform" TEXT,
    "publicKey" TEXT,
    "ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "interval" INTEGER NOT NULL DEFAULT 5,
    "lastPollAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'database',
    "description" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "latestVersion" TEXT,
    "installs" INTEGER NOT NULL DEFAULT 0,
    "ratingAvg" REAL NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tool_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toolId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "objectKey" TEXT,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "scanFindings" JSONB NOT NULL DEFAULT [],
    "reviewNote" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" DATETIME,
    "anchorCode" TEXT,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ToolVersion_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolVersion_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolRating" (
    "toolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("toolId", "userId"),
    CONSTRAINT "ToolRating_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VaultKey" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "publicKey" TEXT NOT NULL,
    "wrapped" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VaultKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VaultDeviceKey" (
    "deviceId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "wrapped" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VaultDeviceKey_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VaultPack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VaultPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'LINK',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "objectKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "messages" INTEGER NOT NULL,
    "model" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "anchorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareAccess" (
    "shareId" TEXT NOT NULL,
    "account" TEXT NOT NULL,

    PRIMARY KEY ("shareId", "account"),
    CONSTRAINT "ShareAccess_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ConversationShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    CONSTRAINT "ShareFile_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ConversationShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StorageObject" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "keccak" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
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
    "wantReplicas" INTEGER,
    "keepUntil" DATETIME,
    "deleteAfter" DATETIME,
    "lastAuditAt" DATETIME,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextTryAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Anchor" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "nextTryAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'skills:publish',
    "deviceId" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApiToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ApiToken" ("createdAt", "id", "lastUsedAt", "name", "prefix", "revokedAt", "tokenHash", "userId") SELECT "createdAt", "id", "lastUsedAt", "name", "prefix", "revokedAt", "tokenHash", "userId" FROM "ApiToken";
DROP TABLE "ApiToken";
ALTER TABLE "new_ApiToken" RENAME TO "ApiToken";
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
CREATE INDEX "VaultDeviceKey_userId_idx" ON "VaultDeviceKey"("userId");

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

