import { afterEach, describe, expect, it, vi } from 'vitest'
import { addressScore, matchProperty, normaliseAddress, sameAddress } from '../src/documents/address'
import { sameFieldValue } from '../src/documents/compare'
import { modelExtract, modelRepair, type ModelCall } from '../src/documents/model'
import { checkModelAnswer, llmValidationMethod } from '../src/documents/pipeline'
import type { InvoiceFields, LeaseFields } from '../src/documents/types'
import { validateInvoice, validateLease, type ReferenceData } from '../src/documents/validate'

vi.mock('../src/documents/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/documents/model')>()),
  modelExtract: vi.fn(),
  modelRepair: vi.fn(),
}))

const REF: ReferenceData = {
  properties: [
    { id: 1, code: 'MTE14', address: '14 Kowhai Road', suburb: 'Mount Eden' },
    { id: 2, code: 'PON7', address: '7 Vine Street', suburb: 'Ponsonby' },
    { id: 3, code: 'ONE3', address: '3/41 Arthur Street', suburb: 'Onehunga' },
    { id: 4, code: 'BLK2', address: '2/8 Manuka Road', suburb: 'Blockhouse Bay' },
  ],
  contractors: [
    { id: 10, name: 'Acme Plumbing', trade: 'plumbing', gstNumber: '102-345-673', bankAccount: '12-3140-0456781-00', email: null },
    { id: 11, name: 'Acme Cleaning Co', trade: 'cleaning', gstNumber: '124-567-890', bankAccount: '06-0193-0654321-00', email: null },
    { id: 12, name: 'Acme Water', trade: 'utilities', gstNumber: '145-432-103', bankAccount: '12-3011-0112233-00', email: null },
  ],
  jobs: [
    { id: 100, propertyId: 2, contractorId: 10, title: 'Leaking kitchen mixer', status: 'completed', quoteAmount: 220 },
    { id: 101, propertyId: 1, contractorId: 10, title: 'Hot water cylinder element', status: 'in_progress', quoteAmount: 480 },
  ],
  leases: [
    { id: 200, propertyId: 2, tenantNames: ['Daniel Kim'], weeklyRent: 650, bondAmount: 2600, startDate: '2024-11-04', endDate: null, status: 'active' },
  ],
  invoices: [],
}

const invoice = (over: Partial<InvoiceFields> = {}): InvoiceFields => ({
  supplierName: 'Acme Plumbing',
  supplierGstNumber: '102-345-673',
  supplierBankAccount: '12-3140-0456781-00',
  invoiceNumber: 'AP-2296',
  invoiceDate: '2026-09-08',
  dueDate: '2026-09-22',
  propertyAddress: '7 Vine St, Ponsonby',
  lineItems: [
    { description: 'Kitchen mixer cartridge', quantity: 1, unitAmount: 58, amount: 58 },
    { description: 'Labour', quantity: 1.25, unitAmount: 80, amount: 100 },
  ],
  subtotal: 158,
  gst: 23.7,
  total: 181.7,
  ...over,
})

const lease = (over: Partial<LeaseFields> = {}): LeaseFields => ({
  tenantNames: ['Daniel Kim'],
  propertyAddress: '7 Vine Street, Ponsonby, Auckland 1011',
  startDate: '2024-11-04',
  endDate: 'periodic',
  weeklyRent: 650,
  bond: 2600,
  rentFrequency: 'weekly',
  petsAllowed: true,
  maxOccupants: 3,
  ...over,
})

const codes = (r: { issues: { code: string; severity: string }[] }) => r.issues.filter((i) => i.severity !== 'info').map((i) => i.code)

describe('address matching', () => {
  it('normalises case, punctuation, abbreviations, unit words, city and postcode', () => {
    expect(normaliseAddress('Flat 3, 41 Arthur St, Onehunga, Auckland 1061')).toBe('3 41 arthur street onehunga')
    expect(normaliseAddress('14 Kowhai Rd, Mt Eden')).toBe('14 kowhai road mount eden')
    expect(normaliseAddress('7 Vine Street, Ponsonby, Auckland 1011, New Zealand')).toBe('7 vine street ponsonby')
  })

  it('matches portfolio addresses written differently, and tolerates a typo', () => {
    expect(matchProperty('14 Kowhai Rd, Mt Eden', REF.properties)?.property.code).toBe('MTE14')
    expect(matchProperty('Unit 2, 8 Manuka Road, Blockhouse Bay', REF.properties)?.property.code).toBe('BLK2')
    expect(matchProperty('3/41 Arthur Street', REF.properties)?.property.code).toBe('ONE3')
    expect(matchProperty('14 Kowhia Road, Mount Eden', REF.properties)?.property.code).toBe('MTE14')
    expect(matchProperty('7 Vine Street, Ponsonbey', REF.properties)?.property.code).toBe('PON7')
  })

  it("doesn't match a different number, street or suburb", () => {
    expect(matchProperty('52 Kahikatea Street, Grey Lynn', REF.properties)).toBeNull()
    expect(matchProperty('16 Kowhai Road, Mount Eden', REF.properties)).toBeNull()
    expect(matchProperty('5/41 Arthur Street, Onehunga', REF.properties)).toBeNull()
    expect(addressScore('14 Kowhai Road, Grey Lynn', REF.properties[0])).toBeLessThan(0.85)
    expect(matchProperty(null, REF.properties)).toBeNull()
  })

  it('compares extracted addresses after normalising', () => {
    expect(sameAddress('14 Kowhai Road, Mount Eden, Auckland 1024', '14 Kowhai Rd, Mt Eden')).toBe(true)
    expect(sameAddress('14 Kowhai Road, Mount Eden', '14 Kowhai Road')).toBe(false)
  })
})

describe('invoice validation', () => {
  it('passes a clean invoice and links supplier, property and job', () => {
    const r = validateInvoice(invoice(), REF)
    expect(r.issues).toEqual([])
    expect(r.links).toEqual({ propertyId: 2, contractorId: 10, maintenanceRequestId: 100, leaseId: null })
  })

  it('checks GST is 3/23 of the total within two cents', () => {
    expect(codes(validateInvoice(invoice({ subtotal: 196, gst: 24.5, total: 220.5 }), REF))).toContain('gst_not_3_23')
    expect(codes(validateInvoice(invoice({ gst: 23.71 }), REF))).not.toContain('gst_not_3_23')
  })

  it('checks subtotal + GST = total and that the lines add up to the subtotal', () => {
    expect(codes(validateInvoice(invoice({ subtotal: 160 }), REF))).toEqual(
      expect.arrayContaining(['totals_dont_add', 'line_items_dont_add']),
    )
    const lines = invoice({ lineItems: [{ description: 'Labour', quantity: 1, unitAmount: 148, amount: 148 }] })
    expect(codes(validateInvoice(lines, REF))).toEqual(['line_items_dont_add'])
  })

  it('checks the GST number: check digit, missing, or not the one on file', () => {
    expect(codes(validateInvoice(invoice({ supplierGstNumber: '102-345-674' }), REF))).toEqual(['gst_number_invalid'])
    expect(codes(validateInvoice(invoice({ supplierGstNumber: null }), REF))).toEqual(['gst_number_missing'])
    expect(codes(validateInvoice(invoice({ supplierGstNumber: '136-543-210' }), REF))).toEqual(['gst_number_differs'])
    // A GST number that belongs to another contractor on file.
    expect(codes(validateInvoice(invoice({ supplierGstNumber: '124-567-890' }), REF))).toContain('supplier_mismatch')
  })

  it('flags a due date before the invoice date', () => {
    expect(codes(validateInvoice(invoice({ dueDate: '2026-09-01' }), REF))).toEqual(['due_before_invoice'])
  })

  it('matches the supplier by GST number when the name is unfamiliar, and flags an unknown supplier', () => {
    const byGst = validateInvoice(invoice({ supplierName: 'A.P. Services' }), REF)
    expect(byGst.links.contractorId).toBe(10)
    const unknown = validateInvoice(invoice({ supplierName: 'Other Trades', supplierGstNumber: '136-543-210' }), REF)
    expect(codes(unknown)).toContain('supplier_unknown')
  })

  it('flags an address outside the portfolio, a missing job, and a total over the quote by more than 10%', () => {
    expect(codes(validateInvoice(invoice({ propertyAddress: '52 Kahikatea Street, Grey Lynn' }), REF))).toEqual(['property_unknown'])
    expect(codes(validateInvoice(invoice({ propertyAddress: '3/41 Arthur Street, Onehunga' }), REF))).toEqual(['job_not_found'])
    // Quote 220: 10% allowance is 242.00.
    const over = invoice({ lineItems: null, subtotal: 212, gst: 31.8, total: 243.8 })
    expect(codes(validateInvoice(over, REF))).toEqual(['over_quote'])
    const within = invoice({ lineItems: null, subtotal: 210, gst: 31.5, total: 241.5 })
    expect(codes(validateInvoice(within, REF))).toEqual([])
  })

  it('notes a job that is not completed yet without raising an alarm', () => {
    const r = validateInvoice(invoice({ propertyAddress: '14 Kowhai Road, Mount Eden', lineItems: null, subtotal: 400, gst: 60, total: 460 }), REF)
    expect(codes(r)).toEqual([])
    expect(r.issues.map((i) => i.code)).toEqual(['job_not_completed'])
  })

  it("doesn't need a job for utility and insurance bills", () => {
    const water = invoice({ supplierName: 'Acme Water', supplierGstNumber: '145-432-103', supplierBankAccount: null, invoiceNumber: 'W-1' })
    expect(validateInvoice(water, REF).issues).toEqual([])
  })

  it('flags a duplicate invoice number from the same supplier only', () => {
    const ref = { ...REF, invoices: [{ documentId: 7, contractorId: 10, supplierName: 'Acme Plumbing', invoiceNumber: 'ap-2296' }] }
    expect(codes(validateInvoice(invoice(), ref))).toEqual(['duplicate_invoice'])
    const otherSupplier = { ...REF, invoices: [{ documentId: 7, contractorId: 11, supplierName: 'Acme Cleaning Co', invoiceNumber: 'AP-2296' }] }
    expect(codes(validateInvoice(invoice(), otherSupplier))).toEqual([])
  })

  it('flags a bank account that differs from the one on file', () => {
    expect(codes(validateInvoice(invoice({ supplierBankAccount: '12-3140-0999999-00' }), REF))).toEqual(['bank_account_differs'])
  })

  it('reports missing required fields', () => {
    expect(codes(validateInvoice(invoice({ invoiceNumber: null, total: null, gst: null, subtotal: null }), REF))).toEqual(
      expect.arrayContaining(['missing_field']),
    )
  })
})

describe('tenancy summary validation', () => {
  it('links the lease and passes when rent and bond agree', () => {
    const r = validateLease(lease(), REF)
    expect(r.issues).toEqual([])
    expect(r.links.leaseId).toBe(200)
  })

  it('compares rent and bond with the lease record', () => {
    expect(codes(validateLease(lease({ weeklyRent: 680 }), REF))).toEqual(['rent_differs'])
    expect(codes(validateLease(lease({ bond: 2400 }), REF))).toEqual(['bond_differs'])
  })

  it('flags a bond above four weeks of rent, and an end date before the start', () => {
    expect(codes(validateLease(lease({ bond: 2640, weeklyRent: 650 }), REF))).toEqual(['bond_over_four_weeks', 'bond_differs'])
    expect(codes(validateLease(lease({ endDate: '2024-01-01' }), REF))).toEqual(['end_before_start'])
  })

  it('warns when the tenants named are not on the lease', () => {
    expect(codes(validateLease(lease({ tenantNames: ['Someone Else'] }), REF))).toEqual(['tenant_differs'])
  })
})

describe('model answers and field confidence', () => {
  afterEach(() => vi.clearAllMocks())

  const answer = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, confidence: 'high' as const }]))

  it('rejects malformed model values with zod', () => {
    const checked = checkModelAnswer('invoice', answer({ ...invoice(), invoiceDate: '08/09/2026', total: -5 }))
    expect(checked.values).toMatchObject({ invoiceDate: null, total: null, invoiceNumber: 'AP-2296' })
    expect(checked.issues.map((i) => [i.code, i.field])).toEqual([
      ['invalid_value', 'invoiceDate'],
      ['invalid_value', 'total'],
    ])
  })

  it('makes one repair call when the checks fail, then sets confidence from the checks and the rules', async () => {
    const text = [
      'Acme Plumbing',
      'TAX INVOICE',
      'Invoice # AP-2296',
      'Date 08/09/2026',
      'Due date 22/09/2026',
      'GST No. 102-345-673',
      'Job address',
      '7 Vine St, Ponsonby',
      'Qty Description Unit price Amount',
      '1 Kitchen mixer cartridge 58.00 58.00',
      '1.25 Labour 80.00 100.00',
      'Subtotal 158.00',
      'GST 15% 23.70',
      'Total NZD $181.70',
    ].join('\n')
    const call = (values: InvoiceFields): ModelCall => ({ answer: answer({ ...values }), raw: '', cached: false, latencyMs: 900 })
    // The first answer misreads the total; the repair reads it correctly but drops the bank account.
    const extract = vi.mocked(modelExtract).mockResolvedValue(call(invoice({ total: 187.1 })))
    const repair = vi.mocked(modelRepair).mockResolvedValue(call(invoice({ supplierBankAccount: null })))

    const result = await llmValidationMethod.run({ text, kind: 'invoice', ref: REF })
    expect(extract).toHaveBeenCalledTimes(1)
    expect(repair).toHaveBeenCalledTimes(1)
    expect(repair.mock.calls[0][3].map((i) => i.code)).toEqual(['gst_not_3_23', 'totals_dont_add'])
    expect(result.issues).toEqual([])
    expect(result.model).toMatchObject({ calls: 2, live: 2, repaired: true, latencyMs: 1800 })
    // Agrees with the rules: high. Changed by the repair: source llm-repair.
    expect(result.extracted.total).toEqual({ value: 181.7, confidence: 'high', source: 'llm-repair' })
    expect(result.extracted.invoiceNumber).toEqual({ value: 'AP-2296', confidence: 'high', source: 'llm' })
    // The rules found no bank account on this text and neither did the repair: nothing to compare, medium.
    expect(result.extracted.supplierBankAccount.confidence).toBe('medium')
  })

  it('gives low confidence to fields a failed check points at, and to disagreements with the rules', async () => {
    const text = 'Acme Plumbing\nTAX INVOICE\nInvoice # AP-2296\nDate 08/09/2026\nGST No. 102-345-673\nSubtotal 158.00\nGST 15% 23.70\nTotal NZD $181.70'
    const misread = invoice({ invoiceNumber: 'AP-2269', dueDate: '2026-09-01' })
    vi.mocked(modelExtract).mockResolvedValue({ answer: answer({ ...misread }), raw: '', cached: true, latencyMs: 800 })
    vi.mocked(modelRepair).mockResolvedValue({ answer: answer({ ...misread }), raw: '', cached: true, latencyMs: 700 })
    const result = await llmValidationMethod.run({ text, kind: 'invoice', ref: REF })
    expect(result.issues.map((i) => i.code)).toEqual(['due_before_invoice'])
    expect(result.extracted.dueDate.confidence).toBe('low')
    expect(result.extracted.invoiceDate.confidence).toBe('low')
    expect(result.extracted.invoiceNumber.confidence).toBe('low') // rules read AP-2296
    expect(result.extracted.total.confidence).toBe('high')
    expect(result.model).toMatchObject({ live: 0, cached: 2 })
  })

  it('compares field values after normalising', () => {
    expect(sameFieldValue('total', 181.7, '$181.70')).toBe(true)
    expect(sameFieldValue('invoiceDate', '2026-09-08', '8 Sep 2026')).toBe(true)
    expect(sameFieldValue('supplierGstNumber', '102345673', '102-345-673')).toBe(true)
    expect(sameFieldValue('supplierName', 'ACME CLEANING CO LTD', 'Acme Cleaning Co')).toBe(true)
    expect(sameFieldValue('tenantNames', ['Priya Patel', 'Rajesh Patel'], ['rajesh patel', 'priya patel'])).toBe(true)
    expect(sameFieldValue('lineItems', [{ amount: 58 }, { amount: 100 }], [{ amount: 100 }, { amount: 58 }])).toBe(true)
    expect(sameFieldValue('endDate', 'Periodic', 'periodic')).toBe(true)
    expect(sameFieldValue('total', null, 0)).toBe(false)
  })
})
