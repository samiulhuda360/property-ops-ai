// Approved invoices to accounting: the Xero bill-import CSV, or a push to the accounting adapter.
// Both are a person's action; afterwards the documents are marked exported. Nothing is paid.
import { accountingAdapter } from '../accounting/adapter'
import { toBill, toXeroBillsCsv, type InvoiceForBill } from '../accounting/xero'
import { prisma } from '../lib/prisma'
import { DocumentError, valuesOf } from './service'
import type { LineItem } from './types'

type DocumentWithContractor = NonNullable<Awaited<ReturnType<typeof findInvoices>>>[number]

function findInvoices(userId: number, where: { ids?: number[]; statuses: string[] }) {
  return prisma.document.findMany({
    where: {
      userId,
      kind: 'invoice',
      status: { in: where.statuses },
      ...(where.ids ? { id: { in: where.ids } } : {}),
    },
    include: { contractor: true },
    orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }],
  })
}

export function invoiceForBill(doc: DocumentWithContractor): InvoiceForBill {
  const v = valuesOf('invoice', doc.extracted)
  const text = (x: unknown) => (typeof x === 'string' ? x : null)
  const num = (x: unknown) => (typeof x === 'number' ? x : null)
  const invoiceNumber = text(v.invoiceNumber)
  const invoiceDate = text(v.invoiceDate)
  const total = num(v.total)
  if (!invoiceNumber || !invoiceDate || total === null) {
    throw new DocumentError(400, `Document ${doc.id} has no invoice number, date or total, so it can't be exported.`)
  }
  return {
    id: doc.id,
    userId: doc.userId,
    supplierName: doc.contractor?.name ?? text(v.supplierName) ?? 'Unknown supplier',
    contactEmail: doc.contractor?.email ?? null,
    trade: doc.contractor?.trade ?? null,
    invoiceNumber,
    invoiceDate,
    dueDate: text(v.dueDate) ?? invoiceDate,
    lineItems: Array.isArray(v.lineItems) ? (v.lineItems as LineItem[]) : [],
    subtotal: num(v.subtotal),
    gst: num(v.gst),
    total,
  }
}

/**
 * The CSV of approved invoices (or of the given ones, to download an export again), and marks them exported.
 * Returns null when there is nothing to export.
 */
export async function exportXeroBills(userId: number, ids?: number[]): Promise<{ csv: string; count: number } | null> {
  const docs = await findInvoices(userId, ids ? { ids, statuses: ['approved', 'exported'] } : { statuses: ['approved'] })
  if (docs.length === 0) return null
  const csv = toXeroBillsCsv(docs.map((d) => toBill(invoiceForBill(d))))
  await prisma.document.updateMany({
    where: { id: { in: docs.filter((d) => d.status === 'approved').map((d) => d.id) } },
    data: { status: 'exported' },
  })
  return { csv, count: docs.length }
}

/** Sends one approved invoice to the accounting adapter as a draft bill, then marks it exported. */
export async function pushToAccounting(userId: number, id: number) {
  const [doc] = Number.isInteger(id) ? await findInvoices(userId, { ids: [id], statuses: ['needs_review', 'approved', 'exported', 'rejected'] }) : []
  if (!doc) throw new DocumentError(404, 'Invoice not found')
  if (doc.status !== 'approved') {
    throw new DocumentError(409, doc.status === 'exported' ? 'This invoice is already exported.' : 'Approve the invoice before sending it to accounting.')
  }
  const adapter = accountingAdapter()
  let bill
  try {
    bill = await adapter.pushBill(toBill(invoiceForBill(doc)))
  } catch (e) {
    if (e instanceof DocumentError) throw e
    throw new DocumentError(409, e instanceof Error ? e.message : 'The accounting system refused the bill.')
  }
  const document = await prisma.document.update({ where: { id }, data: { status: 'exported' } })
  return { document, bill, adapter: adapter.name }
}

export async function listAccountingBills(userId: number) {
  const adapter = accountingAdapter()
  return { adapter: adapter.name, bills: await adapter.listBills({ userId }) }
}
