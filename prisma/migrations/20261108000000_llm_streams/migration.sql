-- CreateTable
CREATE TABLE "LlmStream" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "events" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmStream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmStreamChunk" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "events" JSONB NOT NULL,

    CONSTRAINT "LlmStreamChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LlmStream_key_key" ON "LlmStream"("key");

-- CreateIndex
CREATE INDEX "LlmStream_createdAt_idx" ON "LlmStream"("createdAt");

-- CreateIndex
CREATE INDEX "LlmStreamChunk_streamId_seq_idx" ON "LlmStreamChunk"("streamId", "seq");

-- AddForeignKey
ALTER TABLE "LlmStreamChunk" ADD CONSTRAINT "LlmStreamChunk_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "LlmStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
