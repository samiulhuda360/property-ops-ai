import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AccountingError, MockAccountingAdapter } from '../src/accounting/adapter'
import { toBill, toXeroBillsCsv, XERO_BILL_COLUMNS, type InvoiceForBill } from '../src/accounting/xero'

const invoice: InvoiceForBill = {
  id: 1,
  userId: 1,
  supplierName: 'Acme Plumbing',
  contactEmail: 'accounts@acme-plumbing.example.com',
  trade: 'plumbing',
  invoiceNumber: 'AP-2291',
  invoiceDate: '2026-09-09',
  dueDate: '2026-09-23',
  lineItems: [
    { description: 'Call-out and fault diagnosis', quantity: 1, unitAmount: 85, amount: 85 },
    { description: 'Labour, replace element, "urgent"', quantity: 1.5, unitAmount: 80, amount: 120 },
    { description: '=SUM(A1:A2)', quantity: null, unitAmount: null, amount: 12.5 },
  ],
  subtotal: 217.5,
  gst: 32.63,
  total: 250.13,
}

describe('Xero bill-import CSV', () => {
  it('uses the bill template columns, one row per line, NZ dates and tax-exclusive amounts', () => {
    const csv = toXeroBillsCsv([toBill(invoice)])
    const rows = csv.trimEnd().split('\r\n')
    expect(rows[0]).toBe(XERO_BILL_COLUMNS.join(','))
    expect(rows[0]).toBe('*ContactName,EmailAddress,*InvoiceNumber,*InvoiceDate,*DueDate,Description,*Quantity,*UnitAmount,*AccountCode,*TaxType,Currency')
    expect(rows).toHaveLength(4)
    expect(rows[1]).toBe(
      'Acme Plumbing,accounts@acme-plumbing.example.com,AP-2291,09/09/2026,23/09/2026,Call-out and fault diagnosis,1,85.00,473,15% GST on Expenses,NZD',
    )
    // Quotes are escaped; a line without quantity becomes 1 x amount; formula-like text is neutralised.
    expect(rows[2]).toContain('"Labour, replace element, ""urgent""",1.5,80.00')
    expect(rows[3]).toContain(`'=SUM(A1:A2),1,12.50`)
  })

  it('picks the account code from the trade and falls back to one line for an invoice without items', () => {
    const bill = toBill({ ...invoice, trade: 'insurance', lineItems: [], subtotal: 1826, gst: 273.9, total: 2099.9 })
    expect(bill.lines).toEqual([
      { description: 'Invoice AP-2291', quantity: 1, unitAmount: 1826, accountCode: '433', taxType: '15% GST on Expenses' },
    ])
    expect(toBill({ ...invoice, trade: null }).lines[0].accountCode).toBe('429')
  })
})

describe('mock accounting adapter', () => {
  it('stores pushed bills as drafts in a file and refuses the same bill twice', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mock-accounting-')), 'bills.json')
    const adapter = new MockAccountingAdapter(file)
    const pushed = await adapter.pushBill(toBill(invoice))
    expect(pushed).toMatchObject({ id: 'MOCK-BILL-0001', status: 'DRAFT', invoiceNumber: 'AP-2291' })
    await expect(adapter.pushBill(toBill(invoice))).rejects.toBeInstanceOf(AccountingError)
    expect(await new MockAccountingAdapter(file).listBills({ userId: 1 })).toHaveLength(1)
    expect(await adapter.listBills({ userId: 2 })).toEqual([])
  })
})
