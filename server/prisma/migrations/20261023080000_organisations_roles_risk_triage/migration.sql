-- CreateTable
CREATE TABLE "Organisation" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NZ',
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- DropIndex
DROP INDEX "BankTransaction_userId_importBatch_idx";

-- DropIndex
DROP INDEX "BankTransaction_userId_lineHash_key";

-- DropIndex
DROP INDEX "InboxMessage_userId_externalId_key";

-- DropIndex
DROP INDEX "IssuedInvoice_userId_invoiceNumber_key";

-- DropIndex
DROP INDEX "IssuedInvoice_userId_leaseRef_idx";

-- DropIndex
DROP INDEX "LeaseAbstract_userId_status_idx";

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "entity" TEXT,
ADD COLUMN     "entityId" INTEGER,
ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "AutomationRun" ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "Contractor" ADD COLUMN     "available" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "availableFrom" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "InboxMessage" ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "IssuedInvoice" ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "LeaseAbstract" ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "MaintenanceRequest" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "category" TEXT,
ADD COLUMN     "photoNote" TEXT,
ADD COLUMN     "reviewSeconds" INTEGER,
ADD COLUMN     "triage" JSONB,
ADD COLUMN     "triageMethod" TEXT,
ADD COLUMN     "workOrder" JSONB;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "marketRent" DOUBLE PRECISION,
ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "organisationId" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organisationId" INTEGER,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'manager';

-- Backfill: every existing account becomes the manager of its own organisation, and its data follows it.
INSERT INTO "Organisation" ("name", "slug")
SELECT u."name", 'org-' || u."id" FROM "User" u ORDER BY u."id";
UPDATE "User" u SET "organisationId" = o."id" FROM "Organisation" o WHERE o."slug" = 'org-' || u."id";
UPDATE "Property" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";
UPDATE "Tenant" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";
UPDATE "Contractor" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";
UPDATE "Document" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";
UPDATE "BankTransaction" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";
UPDATE "InboxMessage" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";
UPDATE "AutomationRun" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";
UPDATE "LeaseAbstract" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";
UPDATE "IssuedInvoice" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";
UPDATE "AuditEvent" t SET "organisationId" = u."organisationId" FROM "User" u WHERE t."userId" = u."id";

-- Now every row has an organisation.
ALTER TABLE "User" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Property" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Tenant" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Contractor" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Document" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "BankTransaction" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "InboxMessage" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "AutomationRun" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "LeaseAbstract" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "IssuedInvoice" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "AuditEvent" ALTER COLUMN "organisationId" SET NOT NULL;

-- CreateTable
CREATE TABLE "RentMonth" (
    "id" SERIAL NOT NULL,
    "organisationId" INTEGER NOT NULL,
    "leaseId" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "rentDue" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidDate" TIMESTAMP(3),
    "daysLate" INTEGER NOT NULL DEFAULT 0,
    "arrears30" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RentMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantRisk" (
    "id" SERIAL NOT NULL,
    "organisationId" INTEGER NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "leaseId" INTEGER NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asOfMonth" TEXT NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "band" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "nextStep" TEXT NOT NULL,
    "draft" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "modelVersion" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "reviewSeconds" INTEGER,
    "note" TEXT,

    CONSTRAINT "TenantRisk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentMonth_organisationId_month_idx" ON "RentMonth"("organisationId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "RentMonth_leaseId_month_key" ON "RentMonth"("leaseId", "month");

-- CreateIndex
CREATE INDEX "TenantRisk_organisationId_band_idx" ON "TenantRisk"("organisationId", "band");

-- CreateIndex
CREATE UNIQUE INDEX "TenantRisk_tenantId_leaseId_key" ON "TenantRisk"("tenantId", "leaseId");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_createdAt_idx" ON "AuditEvent"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_entity_entityId_idx" ON "AuditEvent"("organisationId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "AutomationRun_organisationId_createdAt_idx" ON "AutomationRun"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "BankTransaction_organisationId_importBatch_idx" ON "BankTransaction"("organisationId", "importBatch");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_organisationId_lineHash_key" ON "BankTransaction"("organisationId", "lineHash");

-- CreateIndex
CREATE UNIQUE INDEX "InboxMessage_organisationId_externalId_key" ON "InboxMessage"("organisationId", "externalId");

-- CreateIndex
CREATE INDEX "IssuedInvoice_organisationId_leaseRef_idx" ON "IssuedInvoice"("organisationId", "leaseRef");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedInvoice_organisationId_invoiceNumber_key" ON "IssuedInvoice"("organisationId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "LeaseAbstract_organisationId_status_idx" ON "LeaseAbstract"("organisationId", "status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMessage" ADD CONSTRAINT "InboxMessage_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseAbstract" ADD CONSTRAINT "LeaseAbstract_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedInvoice" ADD CONSTRAINT "IssuedInvoice_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentMonth" ADD CONSTRAINT "RentMonth_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentMonth" ADD CONSTRAINT "RentMonth_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantRisk" ADD CONSTRAINT "TenantRisk_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantRisk" ADD CONSTRAINT "TenantRisk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantRisk" ADD CONSTRAINT "TenantRisk_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

