-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "purpose" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "amountBase" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'TWDC',
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "cardId" TEXT,
    "amountTwd" INTEGER,
    "oenId" TEXT,
    "transactionHid" TEXT,
    "checkoutUrl" TEXT,
    "checkoutExpiresAt" DATETIME,
    "paidAt" DATETIME,
    "planId" TEXT,
    "buyer" JSONB,
    "refundedTwd" INTEGER NOT NULL DEFAULT 0,
    "refundedAt" DATETIME,
    "refundReason" TEXT,
    "providerStatus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "error" TEXT,
    "meta" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amount", "amountBase", "amountTwd", "buyer", "checkoutExpiresAt", "checkoutUrl", "confirmedAt", "createdAt", "error", "id", "meta", "oenId", "paidAt", "planId", "provider", "providerStatus", "purpose", "recipient", "refundReason", "refundedAt", "refundedTwd", "status", "taskId", "token", "transactionHid", "txHash", "userId") SELECT "amount", "amountBase", "amountTwd", "buyer", "checkoutExpiresAt", "checkoutUrl", "confirmedAt", "createdAt", "error", "id", "meta", "oenId", "paidAt", "planId", "provider", "providerStatus", "purpose", "recipient", "refundReason", "refundedAt", "refundedTwd", "status", "taskId", "token", "transactionHid", "txHash", "userId" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE UNIQUE INDEX "Payment_oenId_key" ON "Payment"("oenId");
CREATE UNIQUE INDEX "Payment_transactionHid_key" ON "Payment"("transactionHid");
CREATE UNIQUE INDEX "Payment_txHash_key" ON "Payment"("txHash");
CREATE TABLE "new_SavedCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "tokenSealed" TEXT,
    "last4" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" DATETIME,
    "removedAt" DATETIME,
    CONSTRAINT "SavedCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SavedCard" ("activatedAt", "bindingId", "createdAt", "error", "id", "last4", "removedAt", "status", "tokenSealed", "userId") SELECT "activatedAt", "bindingId", "createdAt", "error", "id", "last4", "removedAt", "status", "tokenSealed", "userId" FROM "SavedCard";
DROP TABLE "SavedCard";
ALTER TABLE "new_SavedCard" RENAME TO "SavedCard";
CREATE UNIQUE INDEX "SavedCard_bindingId_key" ON "SavedCard"("bindingId");
CREATE INDEX "SavedCard_userId_status_idx" ON "SavedCard"("userId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

