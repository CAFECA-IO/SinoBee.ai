-- Normalize Skill.tags (text[]) into SkillTag so the schema also works on SQLite

-- CreateTable
CREATE TABLE "SkillTag" (
    "skillId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "SkillTag_pkey" PRIMARY KEY ("skillId","tag")
);

-- CreateIndex
CREATE INDEX "SkillTag_tag_idx" ON "SkillTag"("tag");

-- AddForeignKey
ALTER TABLE "SkillTag" ADD CONSTRAINT "SkillTag_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy existing tags
INSERT INTO "SkillTag" ("skillId", "tag")
SELECT DISTINCT s."id", t.tag FROM "Skill" s, unnest(s."tags") AS t(tag)
ON CONFLICT DO NOTHING;

-- AlterTable
ALTER TABLE "Skill" DROP COLUMN "tags";
