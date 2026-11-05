-- Several styles built together in the product wizard: one draft per style,
-- grouped under the first draft's id. Nullable and additive, so the code
-- already deployed keeps working before and after this runs.

-- AlterTable
ALTER TABLE "ProductDraft" ADD COLUMN     "groupId" TEXT;

-- CreateIndex
CREATE INDEX "ProductDraft_groupId_idx" ON "ProductDraft"("groupId");
