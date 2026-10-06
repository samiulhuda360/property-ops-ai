// Approved supplier invoices as bills, and as a CSV in the column layout of Xero's "Import bills" template:
// one row per line item, the invoice details repeated on every row, amounts excluding GST.
import type { Bill, BillLine } from './adapter'

/** The bill-import template columns, in order (a leading * marks a column Xero requires). */
export const XERO_BILL_COLUMNS = [
  '*ContactName',
  'EmailAddress',
  '*InvoiceNumber',
  '*InvoiceDate',
  '*DueDate',
  'Description',
  '*Quantity',
  '*UnitAmount',
  '*AccountCode',
  '*TaxType',
  'Currency',
] as const

/** Xero's NZ tax rate for purchases that include 15% GST. */
export const TAX_TYPE = '15% GST on Expenses'

/** Expense accounts from Xero's default NZ chart of accounts, by contractor trade. */
export const ACCOUNT_CODES: Record<string, string> = {
  plumbing: '473', // Repairs and Maintenance
  electrical: '473',
  roofing: '473',
  locksmith: '473',
  pest_control: '473',
  gardening: '473',
  cleaning: '408', // Cleaning
  insurance: '433', // Insurance
  utilities: '445', // Light, Power, Heating
}
export const DEFAULT_ACCOUNT_CODE = '429' // General Expenses

export interface InvoiceForBill {
  id: number
  userId: number
  supplierName: string
  contactEmail: string | null
  trade: string | null
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  lineItems: { description: string; quantity: number | null; unitAmount: number | null; amount: number }[]
  subtotal: number | null
  gst: number | null
  total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function toBill(invoice: InvoiceForBill): Bill {
  const accountCode = (invoice.trade && ACCOUNT_CODES[invoice.trade]) || DEFAULT_ACCOUNT_CODE
  const gst = invoice.gst ?? round2((invoice.total * 3) / 23)
  const subtotal = invoice.subtotal ?? round2(invoice.total - gst)
  const lines: BillLine[] = invoice.lineItems.length
    ? invoice.lineItems.map((item) => {
        const exact =
          item.quantity !== null && item.unitAmount !== null && Math.abs(item.quantity * item.unitAmount - item.amount) < 0.005
        return {
          description: item.description,
          quantity: exact ? item.quantity! : 1,
          unitAmount: exact ? item.unitAmount! : item.amount,
          accountCode,
          taxType: TAX_TYPE,
        }
      })
    : [{ description: `Invoice ${invoice.invoiceNumber}`, quantity: 1, unitAmount: subtotal, accountCode, taxType: TAX_TYPE }]
  return {
    userId: invoice.userId,
    documentId: invoice.id,
    contactName: invoice.supplierName,
    contactEmail: invoice.contactEmail,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    currency: 'NZD',
    lines,
    subtotal,
    gst,
    total: invoice.total,
  }
}

/** 2026-09-12 -> 12/09/2026 (NZ organisations import day-first dates). */
const nzDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Two decimals, or four when the unit price needs them (e.g. a per-day charge of 0.2525). */
const unitPrice = (n: number) => (Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? n.toFixed(2) : n.toFixed(4))

function cell(value: string | number | null): string {
  let text = value === null ? '' : String(value)
  // A text cell starting like a formula is neutralised so spreadsheets don't run it.
  if (/^[=+@]/.test(text) || /^-[^\d]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toXeroBillsCsv(bills: Bill[]): string {
  const rows: (string | number | null)[][] = [[...XERO_BILL_COLUMNS]]
  for (const bill of bills) {
    for (const line of bill.lines) {
      rows.push([
        bill.contactName,
        bill.contactEmail,
        bill.invoiceNumber,
        nzDate(bill.invoiceDate),
        nzDate(bill.dueDate),
        line.description,
        line.quantity,
        unitPrice(line.unitAmount),
        line.accountCode,
        line.taxType,
        bill.currency,
      ])
    }
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
