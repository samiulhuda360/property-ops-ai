// Loads what the checks compare against: the manager's properties, contractors, jobs, leases and earlier invoices.
import { prisma } from '../lib/prisma'
import type { ReferenceData } from './validate'

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

function extractedValue(extracted: unknown, field: string): string | null {
  const entry = (extracted as Record<string, { value?: unknown }> | null)?.[field]
  return typeof entry?.value === 'string' ? entry.value : null
}

/**
 * Reference data for one manager. Rejected documents don't count as earlier invoices, and `excludeDocumentId` leaves
 * out the document being re-checked (so it isn't a duplicate of itself).
 */
export async function loadReferenceData(userId: number, options: { excludeDocumentId?: number } = {}): Promise<ReferenceData> {
  const [properties, contractors, jobs, leases, invoices] = await Promise.all([
    prisma.property.findMany({ where: { userId }, select: { id: true, code: true, address: true, suburb: true } }),
    prisma.contractor.findMany({ where: { userId } }),
    prisma.maintenanceRequest.findMany({ where: { property: { userId } } }),
    prisma.lease.findMany({ where: { property: { userId } }, include: { tenant: true } }),
    prisma.document.findMany({
      where: {
        userId,
        kind: 'invoice',
        invoiceNumber: { not: null },
        status: { not: 'rejected' },
        ...(options.excludeDocumentId ? { id: { not: options.excludeDocumentId } } : {}),
      },
      select: { id: true, contractorId: true, invoiceNumber: true, extracted: true },
    }),
  ])

  return {
    properties,
    contractors: contractors.map((c) => ({
      id: c.id,
      name: c.name,
      trade: c.trade,
      gstNumber: c.gstNumber,
      bankAccount: c.bankAccount,
      email: c.email,
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      propertyId: j.propertyId,
      contractorId: j.contractorId,
      title: j.title,
      status: j.status,
      quoteAmount: j.quoteAmount,
    })),
    leases: leases.map((l) => ({
      id: l.id,
      propertyId: l.propertyId,
      tenantNames: [`${l.tenant.firstName} ${l.tenant.lastName}`],
      weeklyRent: l.weeklyRent,
      bondAmount: l.bondAmount,
      startDate: isoDay(l.startDate),
      endDate: l.endDate ? isoDay(l.endDate) : null,
      status: l.status,
    })),
    invoices: invoices.map((d) => ({
      documentId: d.id,
      contractorId: d.contractorId,
      supplierName: extractedValue(d.extracted, 'supplierName'),
      invoiceNumber: d.invoiceNumber!,
    })),
  }
}
