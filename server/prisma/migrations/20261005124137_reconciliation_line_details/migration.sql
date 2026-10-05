-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "aiSuggestion" JSONB,
ADD COLUMN     "details" JSONB,
ADD COLUMN     "lineHash" TEXT,
ADD COLUMN     "resolution" JSONB;

-- CreateIndex
CREATE INDEX "BankTransaction_userId_importBatch_idx" ON "BankTransaction"("userId", "importBatch");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_userId_lineHash_key" ON "BankTransaction"("userId", "lineHash");

