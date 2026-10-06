// The accounting system behind one interface. A bill pushed here is a draft for the accounts person to approve
// in the accounting system: nothing is paid. The mock keeps bills in a JSON file so the demo survives restarts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface BillLine {
  description: string
  quantity: number
  /** Excluding GST. */
  unitAmount: number
  accountCode: string
  taxType: string
}

export interface Bill {
  userId: number
  documentId: number
  contactName: string
  contactEmail: string | null
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  currency: string
  lines: BillLine[]
  subtotal: number
  gst: number
  total: number
}

export interface PushedBill extends Bill {
  id: string
  /** Bills arrive as drafts awaiting approval in the accounting system. */
  status: 'DRAFT'
  pushedAt: string
}

export interface AccountingAdapter {
  readonly name: string
  pushBill(bill: Bill): Promise<PushedBill>
  listBills(filter?: { userId?: number }): Promise<PushedBill[]>
}

export class AccountingError extends Error {}

export class MockAccountingAdapter implements AccountingAdapter {
  readonly name = 'Mock accounting (local file)'

  constructor(private readonly file: string) {}

  private read(): PushedBill[] {
    if (!existsSync(this.file)) return []
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as PushedBill[]
    } catch {
      return []
    }
  }

  async pushBill(bill: Bill): Promise<PushedBill> {
    const bills = this.read()
    const clash = bills.find(
      (b) =>
        b.userId === bill.userId &&
        b.contactName.toLowerCase() === bill.contactName.toLowerCase() &&
        b.invoiceNumber.toUpperCase() === bill.invoiceNumber.toUpperCase(),
    )
    if (clash) throw new AccountingError(`${bill.contactName} bill ${bill.invoiceNumber} is already in the accounting system (${clash.id}).`)
    const pushed: PushedBill = {
      ...bill,
      id: `MOCK-BILL-${String(bills.length + 1).padStart(4, '0')}`,
      status: 'DRAFT',
      pushedAt: new Date().toISOString(),
    }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify([...bills, pushed], null, 2))
    return pushed
  }

  async listBills(filter: { userId?: number } = {}): Promise<PushedBill[]> {
    return this.read().filter((b) => filter.userId === undefined || b.userId === filter.userId)
  }
}

/** The adapter in use. Only the mock exists; a real connector implements the same two methods. */
export function accountingAdapter(): AccountingAdapter {
  const file = process.env.ACCOUNTING_MOCK_FILE || resolve(__dirname, '../../storage/accounting/mock-bills.json')
  return new MockAccountingAdapter(file)
}
