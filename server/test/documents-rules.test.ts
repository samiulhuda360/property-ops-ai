import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findMoney, parseDate, parseMoney } from '../src/documents/parse'
import { detectKind, extractInvoiceRules, extractLeaseRules } from '../src/documents/rules'
import { cleanText, looksLikePdf, pdfText } from '../src/documents/text'

const DATA = join(__dirname, '../../data/documents')
const SUPPLIERS = ['Acme Plumbing', 'Acme Electrical', 'Acme Gardens', 'Acme Locksmiths', 'Acme Water']

describe('parsing values', () => {
  it('reads NZ date formats as ISO, day first', () => {
    expect(parseDate('12/09/2026')).toBe('2026-09-12')
    expect(parseDate('03/09/2026')).toBe('2026-09-03')
    expect(parseDate('12 Sep 2026')).toBe('2026-09-12')
    expect(parseDate('Please pay by 5 October 2026 to account 06-0193-0654321-00')).toBe('2026-10-05')
    expect(parseDate('2026-09-12')).toBe('2026-09-12')
    expect(parseDate('31/02/2026')).toBeNull()
    expect(parseDate('Account 4011-2290-1')).toBeNull()
  })

  it('reads money with and without $ and thousands separators', () => {
    expect(findMoney('Total payable $2,099.90')).toEqual([2099.9])
    expect(findMoney('Payment received, thank you -251.20')).toEqual([-251.2])
    expect(findMoney('Sum insured $780,000 · Excess $500')).toEqual([])
    expect(parseMoney('$1,420.00')).toBe(1420)
    expect(parseMoney(64.8)).toBe(64.8)
    expect(parseMoney('none')).toBeNull()
  })
})

describe('text and kind', () => {
  it('drops page markers and collapses whitespace', () => {
    expect(cleanText('Invoice #\tAP-1\n\n-- 1 of 1 --\n')).toBe('Invoice # AP-1')
  })

  it('recognises a PDF by its header', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7'))).toBe(true)
    expect(looksLikePdf(new TextEncoder().encode('hello'))).toBe(false)
  })

  it('tells invoices from tenancy summaries', () => {
    expect(detectKind('TAX INVOICE\nInvoice # AP-1\nGST 15% 10.00\nTotal $76.67')).toBe('invoice')
    expect(detectKind('TENANCY SUMMARY\nTenant(s) Aroha Ngata\nRent $720.00 per week\nBond $2,880.00\nPeriodic')).toBe('lease')
  })
})

describe('invoice rules', () => {
  it('reads a classic table invoice', () => {
    const text = [
      'Acme Plumbing',
      '88 Industry Road, Penrose, Auckland 1061',
      'TAX INVOICE',
      'Invoice # AP-2291',
      'Date 09/09/2026',
      'Due date 23/09/2026',
      'GST No. 102-345-673',
      'Bill to',
      'Property Ops Ltd',
      'PO Box 5120',
      'Job address',
      '14 Kowhai Road, Mount Eden, Auckland 1024',
      'Qty Description Unit price Amount',
      '1 Call-out and fault diagnosis 85.00 85.00',
      '1.5 Labour (hours) 80.00 120.00',
      'Subtotal 205.00',
      'GST 15% 30.75',
      'Total NZD $235.75',
      'Please pay by direct credit to 12-3140-0456781-00, using reference AP-2291.',
    ].join('\n')
    const f = extractInvoiceRules(text, { knownSuppliers: SUPPLIERS })
    expect(f).toMatchObject({
      supplierName: 'Acme Plumbing',
      supplierGstNumber: '102-345-673',
      supplierBankAccount: '12-3140-0456781-00',
      invoiceNumber: 'AP-2291',
      invoiceDate: '2026-09-09',
      dueDate: '2026-09-23',
      propertyAddress: '14 Kowhai Road, Mount Eden, Auckland 1024',
      subtotal: 205,
      gst: 30.75,
      total: 235.75,
    })
    expect(f.lineItems).toEqual([
      { description: 'Call-out and fault diagnosis', quantity: 1, unitAmount: 85, amount: 85 },
      { description: 'Labour (hours)', quantity: 1.5, unitAmount: 80, amount: 120 },
    ])
  })

  it('reads values on the line after letter-spaced labels and joins a wrapped address', () => {
    const text = [
      'Acme Electrical',
      'S I T E',
      '22 Ash Street, Glen Innes,',
      'Auckland 1072',
      'TAX INVOICE NUMBER',
      'E-10418',
      'GST REGISTRATION',
      '113-456-787',
      'ISSUE DATE',
      '3 Sep 2026',
      'PAYMENT DUE',
      '17 Sep 2026',
      'DESCRIPTION QTY RATE AMOUNT',
      '10-year photoelectric smoke alarm 3 54.00 162.00',
      'Subtotal (excl. GST) 162.00',
      'GST 24.30',
      'Amount due $186.30',
    ].join('\n')
    const f = extractInvoiceRules(text, { knownSuppliers: SUPPLIERS })
    expect(f.invoiceNumber).toBe('E-10418')
    expect(f.supplierGstNumber).toBe('113-456-787')
    expect(f.invoiceDate).toBe('2026-09-03')
    expect(f.dueDate).toBe('2026-09-17')
    expect(f.propertyAddress).toBe('22 Ash Street, Glen Innes, Auckland 1072')
    expect(f.lineItems).toEqual([{ description: '10-year photoelectric smoke alarm', quantity: 3, unitAmount: 54, amount: 162 }])
    expect(f.total).toBe(186.3)
  })

  it('reads a receipt whose item wraps over three lines, and a missing GST number as null', () => {
    const text = [
      'ACME LOCKSMITHS',
      'TAX INVOICE',
      'Inv No. L-0877',
      'Date 2026-09-11',
      'Due 2026-09-25',
      'Site: 9 Totara Ave, Takapuna',
      'Customer: Property Ops Ltd',
      '1 x Replace front door lock',
      'cylinder',
      '145.00',
      '3 x Re-key, cut keys 36.00',
      'SUBTOTAL 181.00',
      'GST 15% 27.15',
      'TOTAL 208.15',
    ].join('\n')
    const f = extractInvoiceRules(text, { knownSuppliers: SUPPLIERS })
    expect(f.supplierName).toBe('Acme Locksmiths')
    expect(f.supplierGstNumber).toBeNull()
    expect(f.propertyAddress).toBe('9 Totara Ave, Takapuna')
    expect(f.lineItems).toEqual([
      { description: 'Replace front door lock cylinder', quantity: 1, unitAmount: 145, amount: 145 },
      { description: 'Re-key, cut keys', quantity: 3, unitAmount: 12, amount: 36 },
    ])
  })

  it('reads a letter: undated header date, address in the Re: line, due date in a sentence', () => {
    const text = [
      'Acme Cleaning Co',
      '210 Great South Road, Greenlane, Auckland 1051 · 09 555 0162 · GST 124-567-890',
      '21 September 2026',
      'Re: Mould treatment, bedroom 2 – 11 Kauri Lane, New Lynn',
      'We completed the work at the above address on 19 September 2026.',
      'Invoice number: CC-3381',
      'Mould treatment and anti-fungal wash $280.00',
      'Subtotal $280.00',
      'GST (15%) $42.00',
      'Total including GST $322.00',
      'Please pay by 5 October 2026 to account 06-0193-0654321-00, quoting the invoice number.',
    ].join('\n')
    const f = extractInvoiceRules(text)
    expect(f.supplierName).toBe('Acme Cleaning Co')
    expect(f.invoiceDate).toBe('2026-09-21')
    expect(f.dueDate).toBe('2026-10-05')
    expect(f.propertyAddress).toBe('11 Kauri Lane, New Lynn')
    expect(f.supplierGstNumber).toBe('124-567-890')
    expect(f.total).toBe(322)
  })

  it('reads a utility bill without taking the billing period or meter dates', async () => {
    const text = await pdfText(readFileSync(join(DATA, 'water-04-hnd5.pdf')))
    const f = extractInvoiceRules(text, { knownSuppliers: SUPPLIERS })
    expect(f).toMatchObject({
      supplierName: 'Acme Water',
      invoiceNumber: 'W-883125',
      invoiceDate: '2026-09-14',
      dueDate: '2026-09-04',
      propertyAddress: '5 Rimu Crescent, Henderson, Auckland 0612',
      subtotal: 295.2,
      gst: 44.28,
      total: 339.48,
    })
    expect(f.lineItems?.map((l) => l.amount)).toEqual([23, 79.8, 101.2, 91.2])
  })
})

describe('tenancy summary rules', () => {
  it('reads the agency layout', () => {
    const text = [
      'Property Ops Ltd · Property management',
      'TENANCY SUMMARY',
      'Property 18 Matai Road, Papatoetoe, Auckland 2025',
      'Tenant(s) Ana Tupou and Sione Tupou',
      'Tenancy type Periodic',
      'Start date 2024-07-22',
      'End date Periodic (no end date)',
      'Rent $850.00 per week',
      'Rent paid Fortnightly in advance, by automatic payment',
      'Bond $3,400.00',
      'Pets Permitted (one dog, outdoors)',
      'Maximum occupants 6',
    ].join('\n')
    expect(extractLeaseRules(text)).toEqual({
      tenantNames: ['Ana Tupou', 'Sione Tupou'],
      propertyAddress: '18 Matai Road, Papatoetoe, Auckland 2025',
      startDate: '2024-07-22',
      endDate: 'periodic',
      weeklyRent: 850,
      bond: 3400,
      rentFrequency: 'fortnightly',
      petsAllowed: true,
      maxOccupants: 6,
    })
  })

  it('reads the card layout: fortnightly rent to weekly, fixed-term dates', () => {
    const text = [
      'TENANCY SUMMARY Residential tenancy · key terms',
      'T H E P E O P L E',
      "Tenants: Liam O'Brien",
      'T H E P L A C E',
      '11 Kauri Lane, New Lynn, Auckland 0600',
      'T H E T E R M',
      'Fixed term from 06/10/2025 to 05/10/2026',
      'T H E M O N E Y',
      'Rent: $1,080.00 per fortnight, paid fortnightly in advance',
      'Bond: $2,160.00',
      'Pets: No',
      'Max. occupants: 2',
      "Tenant pays water usage on the bill to the landlord.",
    ].join('\n')
    expect(extractLeaseRules(text)).toEqual({
      tenantNames: ["Liam O'Brien"],
      propertyAddress: '11 Kauri Lane, New Lynn, Auckland 0600',
      startDate: '2025-10-06',
      endDate: '2026-10-05',
      weeklyRent: 540,
      bond: 2160,
      rentFrequency: 'fortnightly',
      petsAllowed: false,
      maxOccupants: 2,
    })
  })
})
