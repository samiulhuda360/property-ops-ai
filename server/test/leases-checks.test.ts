import { describe, expect, it } from 'vitest'
import { addMonths, daysBetween, scheduleCharges } from '../src/leases/charges'
import { reconcileCharges, type IssuedInvoiceRef } from '../src/leases/reconcile'
import { findRisks, loadPlaybook } from '../src/leases/risks'
import type { LeaseTerms } from '../src/leases/types'
import { checkValues, validateTerms } from '../src/leases/validate'

const base: LeaseTerms = {
  leaseRef: 'ACM-NZ-C-01',
  landlord: 'Acme Property Group Limited',
  tenant: 'Harbourline Coffee Limited',
  guarantor: 'James Harper',
  premises: 'Ground Floor, 118 Quay Street, Auckland 1010',
  commencementDate: '2026-04-01',
  expiryDate: '2031-03-31',
  termMonths: 60,
  rentAmount: 7000,
  rentFrequency: 'monthly',
  annualRent: 84000,
  currency: 'NZD',
  reviewMechanism: 'fixed',
  reviewPercent: 3,
  reviewDates: ['2027-04-01', '2028-04-01', '2029-04-01', '2030-04-01'],
  outgoingsBasis: 'proportion',
  outgoingsAnnual: 14200,
  bondAmount: 21000,
  breakNoticeMonths: null,
  breakDate: null,
  renewalTerms: 1,
  renewalTermMonths: 60,
  permittedUse: 'Cafe and takeaway food',
  makeGood: 'tenant_cost',
  insurance: 'landlord',
}

describe('field schemas', () => {
  it('normalises enums, money strings and blanks', () => {
    const { values, issues } = checkValues({ ...base, currency: 'nzd', rentAmount: '7,000.00', guarantor: '', outgoingsBasis: 'Landlord pays' })
    expect(issues).toEqual([])
    expect(values.currency).toBe('NZD')
    expect(values.rentAmount).toBe(7000)
    expect(values.guarantor).toBeNull()
    expect(values.outgoingsBasis).toBe('landlord_pays')
  })
  it('turns a value that fails its schema into null plus an issue', () => {
    const { values, issues } = checkValues({ ...base, commencementDate: '2026-02-30', termMonths: 'five' })
    expect(values.commencementDate).toBeNull()
    expect(values.termMonths).toBeNull()
    expect(issues.map((i) => i.field).sort()).toEqual(['commencementDate', 'termMonths'])
  })
})

describe('cross-field checks', () => {
  it('passes a consistent commercial lease', () => {
    expect(validateTerms(base, 'NZ', 'commercial')).toEqual([])
  })
  it('flags expiry before commencement, a term that disagrees with the dates, and reviews outside the term', () => {
    const codes = validateTerms({ ...base, expiryDate: '2026-03-31', reviewDates: ['2032-04-01'] }, 'NZ', 'commercial').map((i) => i.code)
    expect(codes).toContain('expiry_before_commencement')
    expect(codes).toContain('review_outside_term')
    const term = validateTerms({ ...base, termMonths: 36 }, 'NZ', 'commercial').map((i) => i.code)
    expect(term).toContain('term_disagrees_with_dates')
  })
  it('flags an annual rent that does not agree with the rent per period, and a currency from another country', () => {
    const codes = validateTerms({ ...base, annualRent: 90000, currency: 'USD' }, 'NZ', 'commercial').map((i) => i.code)
    expect(codes).toContain('annual_rent_disagrees')
    expect(codes).toContain('currency_country_mismatch')
  })
  it('flags a residential bond above the country limit, with the limit in the message', () => {
    const t: LeaseTerms = { ...base, rentAmount: 640, rentFrequency: 'weekly', annualRent: 33280, bondAmount: 3840, outgoingsBasis: 'landlord_pays', outgoingsAnnual: null, reviewMechanism: 'none', reviewPercent: null, reviewDates: null, renewalTerms: 0, renewalTermMonths: null, makeGood: 'fair_wear' }
    const issues = validateTerms(t, 'NZ', 'residential')
    expect(issues.map((i) => i.code)).toEqual(['bond_over_limit'])
    expect(issues[0].message).toContain('4 weeks')
    expect(validateTerms({ ...t, bondAmount: 2560 }, 'NZ', 'residential')).toEqual([])
  })
  it('lists the required terms that are missing', () => {
    const codes = validateTerms({ ...base, landlord: null, rentAmount: null }, 'NZ', 'commercial')
    expect(codes.filter((i) => i.code === 'missing_field').map((i) => i.field).sort()).toEqual(['landlord', 'rentAmount'])
  })
})

describe('charge schedule', () => {
  it('adds months with end-of-month clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-31', 12)).toBe('2027-03-31')
    expect(daysBetween('2026-01-01', '2026-01-04')).toBe(3)
  })
  it('schedules the bond, twelve monthly rents and twelve outgoings instalments', () => {
    const charges = scheduleCharges(base)
    expect(charges.filter((c) => c.kind === 'bond')).toHaveLength(1)
    expect(charges.filter((c) => c.kind === 'rent')).toHaveLength(12)
    expect(charges.filter((c) => c.kind === 'outgoings')).toHaveLength(12)
    expect(charges.find((c) => c.kind === 'outgoings')?.amount).toBe(1183.33)
    expect(charges.filter((c) => c.kind === 'rent').map((c) => c.dueDate)[11]).toBe('2027-03-01')
  })
  it('stops at expiry for a short term and follows weekly and quarterly frequencies', () => {
    const weekly = scheduleCharges({ ...base, rentFrequency: 'weekly', rentAmount: 640, termMonths: 6, expiryDate: '2026-09-30', outgoingsBasis: 'landlord_pays' })
    expect(weekly.filter((c) => c.kind === 'rent')).toHaveLength(27)
    expect(weekly.some((c) => c.kind === 'outgoings')).toBe(false)
    const quarterly = scheduleCharges({ ...base, rentFrequency: 'quarterly', rentAmount: 10500 })
    expect(quarterly.filter((c) => c.kind === 'rent').map((c) => c.dueDate)).toEqual(['2026-04-01', '2026-07-01', '2026-10-01', '2027-01-01'])
  })
  it('returns nothing without the terms a schedule needs', () => {
    expect(scheduleCharges({ ...base, rentFrequency: null })).toEqual([])
  })
})

describe('reconciliation', () => {
  const charges = scheduleCharges({ ...base, outgoingsBasis: 'landlord_pays', outgoingsAnnual: null })
  const invoice = (id: number, kind: string, dueDate: string, amount: number, extra: Partial<IssuedInvoiceRef> = {}): IssuedInvoiceRef => ({
    id,
    invoiceNumber: `INV-${id}`,
    sourceRow: id + 1,
    leaseRef: 'ACM-NZ-C-01',
    description: kind,
    kind,
    amount,
    currency: 'NZD',
    dueDate,
    ...extra,
  })
  it('matches, and reports a different amount, a missing charge and an unexpected invoice with the source row', () => {
    const invoices = [
      invoice(1, 'bond', '2026-04-01', 21000),
      invoice(2, 'rent', '2026-04-02', 7000),
      invoice(3, 'rent', '2026-05-01', 6700),
      ...Array.from({ length: 9 }, (_, i) => invoice(10 + i, 'rent', addMonths('2026-07-01', i), 7000)),
      invoice(30, 'other', '2026-06-15', 180, { description: 'Cleaning fee' }),
      invoice(31, 'rent', '2026-04-01', 7000, { leaseRef: 'OTHER-LEASE' }),
    ]
    const r = reconcileCharges('ACM-NZ-C-01', charges, invoices)
    expect(r.counts).toEqual({ matched: 11, amount_differs: 1, missing: 1, unexpected: 1 })
    const differs = r.lines.find((l) => l.status === 'amount_differs')!
    expect(differs.difference).toBe(-300)
    expect(differs.note).toContain('row 4')
    expect(r.lines.find((l) => l.status === 'missing')?.expected?.dueDate).toBe('2026-06-01')
    expect(r.lines.find((l) => l.status === 'unexpected')?.invoice?.invoiceNumber).toBe('INV-30')
  })
  it('reports every charge as missing when the lease reference is unknown', () => {
    const r = reconcileCharges(null, charges, [invoice(1, 'bond', '2026-04-01', 21000)])
    expect(r.counts.missing).toBe(charges.length)
  })
})

describe('risk playbook', () => {
  const pages = (text: string) => [{ num: 1, text }]
  it('loads nine rules with valid patterns', () => {
    const pb = loadPlaybook()
    expect(pb.rules).toHaveLength(9)
    expect(pb.rules.map((r) => r.code)).toContain('ratchet_review')
  })
  it('raises a finding from the terms and cites the field, and one from the text with the sentence', () => {
    const text = '4. Rent Review\nThe Rent payable from a Rent Review Date shall in no case be less than the Rent payable immediately before that date.\n5. Guarantee\nJames Harper personally guarantees to the Landlord the payment of the Rent.'
    const extracted = { makeGood: { value: 'tenant_cost', page: 2, quote: 'At the end of the Term the Tenant shall at its own cost remove its fit-out.', confidence: 'high', source: 'llm', status: 'extracted' } } as never
    const findings = findRisks(base, extracted, pages(text), 'commercial')
    const codes = findings.map((f) => f.code)
    expect(codes).toContain('ratchet_review')
    expect(codes).toContain('personal_guarantee')
    expect(codes).toContain('make_good_tenant_cost')
    expect(codes).toContain('uncapped_outgoings')
    expect(findings.find((f) => f.code === 'ratchet_review')?.quote).toBe('The Rent payable from a Rent Review Date shall in no case be less than the Rent payable immediately before that date.')
    expect(findings.find((f) => f.code === 'ratchet_review')?.page).toBe(1)
    expect(findings.find((f) => f.code === 'make_good_tenant_cost')?.page).toBe(2)
  })
  it('does not raise uncapped outgoings when a cap is in the text, nor a landlord break for "neither party"', () => {
    const text = "The Tenant's liability for outgoings in any year is capped at the previous year's outgoings increased by 4%. Neither party may terminate this lease before the Expiry Date."
    const codes = findRisks({ ...base, guarantor: null, makeGood: 'fair_wear' }, null, pages(text), 'commercial').map((f) => f.code)
    expect(codes).toEqual([])
  })
  it('raises short notice, a high fixed review and a short term with no renewal from the terms alone', () => {
    const codes = findRisks({ ...base, guarantor: null, makeGood: 'fair_wear', outgoingsBasis: 'landlord_pays', breakNoticeMonths: 1, reviewPercent: 5, termMonths: 24, renewalTerms: 0 }, null, pages(''), 'commercial').map((f) => f.code).sort()
    expect(codes).toEqual(['fixed_review_high', 'no_renewal_short_term', 'short_break_notice'])
  })
})
