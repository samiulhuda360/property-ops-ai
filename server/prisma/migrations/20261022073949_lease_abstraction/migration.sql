-- CreateTable
CREATE TABLE "LeaseAbstract" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT,
    "pages" JSONB NOT NULL,
    "country" TEXT,
    "leaseType" TEXT,
    "route" TEXT NOT NULL,
    "leaseRef" TEXT,
    "terms" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "charges" JSONB NOT NULL,
    "reconciliation" JSONB,
    "status" TEXT NOT NULL DEFAULT 'needs_review',
    "propertyId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaseAbstract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedInvoice" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "leaseRef" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "period" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "leaseAbstractId" INTEGER,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaseAbstract_userId_status_idx" ON "LeaseAbstract"("userId", "status");

-- CreateIndex
CREATE INDEX "IssuedInvoice_userId_leaseRef_idx" ON "IssuedInvoice"("userId", "leaseRef");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedInvoice_userId_invoiceNumber_key" ON "IssuedInvoice"("userId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "AuditEvent_leaseAbstractId_createdAt_idx" ON "AuditEvent"("leaseAbstractId", "createdAt");

-- AddForeignKey
ALTER TABLE "LeaseAbstract" ADD CONSTRAINT "LeaseAbstract_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseAbstract" ADD CONSTRAINT "LeaseAbstract_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedInvoice" ADD CONSTRAINT "IssuedInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_leaseAbstractId_fkey" FOREIGN KEY ("leaseAbstractId") REFERENCES "LeaseAbstract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
