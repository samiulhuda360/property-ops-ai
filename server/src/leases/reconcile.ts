// Charges against invoices: every expected charge from the abstracted schedule is looked for among the billing
// system's issued invoices for the same lease reference (same kind, due within three days); the amount must agree to
// the cent. Invoices with no expected charge are unexpected. Every line cites the invoice number and its source row.
import { daysBetween } from './charges'
import type { Charge, Reconciliation, ReconciliationLine, ReconciliationStatus } from './types'

export interface IssuedInvoiceRef {
  id: number
  invoiceNumber: string
  /** The row in the import file the invoice came from, for citing. */
  sourceRow: number
  leaseRef: string
  description: string
  kind: string
  amount: number
  currency: string
  dueDate: string
}

const toLine = (inv: IssuedInvoiceRef) => ({
  id: inv.id,
  invoiceNumber: inv.invoiceNumber,
  row: inv.sourceRow,
  kind: inv.kind,
  amount: inv.amount,
  currency: inv.currency,
  dueDate: inv.dueDate,
  description: inv.description,
})

export function reconcileCharges(leaseRef: string | null, charges: Charge[], invoices: IssuedInvoiceRef[]): Reconciliation {
  const counts: Record<ReconciliationStatus, number> = { matched: 0, amount_differs: 0, missing: 0, unexpected: 0 }
  const lines: ReconciliationLine[] = []
  const pool = leaseRef ? invoices.filter((i) => i.leaseRef.toUpperCase() === leaseRef.toUpperCase()) : []
  const used = new Set<number>()
  for (const charge of charges) {
    const candidates = pool
      .filter((i) => !used.has(i.id) && i.kind === charge.kind && Math.abs(daysBetween(charge.dueDate, i.dueDate)) <= 3)
      .sort((a, b) => Math.abs(a.amount - charge.amount) - Math.abs(b.amount - charge.amount))
    const inv = candidates[0]
    if (!inv) {
      lines.push({ status: 'missing', expected: charge, invoice: null, difference: null, note: `No ${charge.kind} invoice found for ${charge.dueDate}.` })
      counts.missing++
      continue
    }
    used.add(inv.id)
    const difference = Math.round((inv.amount - charge.amount) * 100) / 100
    if (Math.abs(difference) < 0.005 && inv.currency === charge.currency) {
      lines.push({ status: 'matched', expected: charge, invoice: toLine(inv), difference: 0, note: `${inv.invoiceNumber} (row ${inv.sourceRow}) matches.` })
      counts.matched++
    } else {
      lines.push({
        status: 'amount_differs',
        expected: charge,
        invoice: toLine(inv),
        difference,
        note:
          inv.currency !== charge.currency
            ? `${inv.invoiceNumber} (row ${inv.sourceRow}) is in ${inv.currency}; the lease is in ${charge.currency}.`
            : `${inv.invoiceNumber} (row ${inv.sourceRow}) is ${difference > 0 ? 'over' : 'under'} by ${Math.abs(difference).toFixed(2)}.`,
      })
      counts.amount_differs++
    }
  }
  for (const inv of pool) {
    if (used.has(inv.id)) continue
    lines.push({ status: 'unexpected', expected: null, invoice: toLine(inv), difference: null, note: `${inv.invoiceNumber} (row ${inv.sourceRow}): the lease has no ${inv.kind} charge due ${inv.dueDate}.` })
    counts.unexpected++
  }
  lines.sort((a, b) => (a.expected?.dueDate ?? a.invoice?.dueDate ?? '').localeCompare(b.expected?.dueDate ?? b.invoice?.dueDate ?? ''))
  return { leaseRef, lines, counts }
}
