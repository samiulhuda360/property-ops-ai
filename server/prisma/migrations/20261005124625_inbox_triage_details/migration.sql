-- AlterTable
ALTER TABLE "InboxMessage" ADD COLUMN     "method" TEXT,
ADD COLUMN     "triage" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "InboxMessage_userId_externalId_key" ON "InboxMessage"("userId", "externalId");

