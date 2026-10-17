-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "termsVersion" INTEGER;

-- AlterTable
ALTER TABLE "Pledge" ADD COLUMN     "termsVersion" INTEGER;

-- CreateTable
CREATE TABLE "ChecklistVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "ChecklistVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalVersion" (
    "id" TEXT NOT NULL,
    "doc" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "markdown" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "anchorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistVersion_publishedAt_version_idx" ON "ChecklistVersion"("publishedAt", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LegalVersion_doc_locale_version_key" ON "LegalVersion"("doc", "locale", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LegalVersion_doc_locale_sha256_key" ON "LegalVersion"("doc", "locale", "sha256");
