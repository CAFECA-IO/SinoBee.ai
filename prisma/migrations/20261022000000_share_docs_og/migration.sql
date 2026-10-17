-- Shares of documents (reports, interactive pages) and link previews (description + 1200×630 picture)
ALTER TABLE "ConversationShare" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE "ConversationShare" ADD COLUMN "entry" TEXT;
ALTER TABLE "ConversationShare" ADD COLUMN "description" TEXT;
ALTER TABLE "ConversationShare" ADD COLUMN "ogKey" TEXT;
