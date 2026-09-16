-- Name rules for style re-grouping. Additive; no existing table is touched.
--
-- Replaces the hand-edited NEW_STYLE_GROUPS / PARENT_OVERRIDE constants in
-- master/regroup-styles.ts, which a review screen cannot append to.

-- CreateEnum
CREATE TYPE "StyleNameRuleKind" AS ENUM ('COMPOUND', 'PARENT_OVERRIDE', 'KEEP_SEPARATE');

-- CreateTable
CREATE TABLE "StyleNameRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StyleNameRuleKind" NOT NULL,
    "parent" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleNameRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StyleNameRule_name_key" ON "StyleNameRule"("name");

-- No seed here. The baseline list of compound names lives in
-- src/lib/master/style-name-rules.ts, so the report works before this migration
-- lands and the two can never drift. This table holds the decisions made in the
-- review screen, which are layered over that baseline.
