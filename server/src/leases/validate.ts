// Business checks on the abstracted terms: dates parse and are consistent, the term agrees with the dates, reviews
// and breaks fall inside the term, the annual rent agrees with the rent per period, the currency matches the
// country, and the bond is within the usual limits. Every alarm names the fields it puts in doubt.
import { z } from 'zod'
import { addMonths, daysBetween } from './charges'
import {
  COUNTRY_CURRENCY,
  FIELD_LABELS,
  PERIODS_PER_YEAR,
  TERM_FIELDS,
  type Country,
  type Issue,
  type LeaseTerms,
  type LeaseType,
  type TermField,
} from './types'

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date written YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
  }, 'is not a real calendar date')

/** A string becomes a number only when it carries digits ("7,000.00", "$7000"); "lots" stays a string and fails. */
const numeric = (v: unknown) => (typeof v === 'string' && /\d/.test(v) ? Number(v.replace(/[^0-9.-]/g, '')) : v)

const money = z.preprocess(
  numeric,
  z.number().finite().nonnegative('cannot be negative').refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'has more than two decimals'),
)
const count = z.preprocess(numeric, z.number().int('must be a whole number').nonnegative())
const text = z.string().trim().min(2, 'is too short')

export const VALUE_SCHEMAS: Record<TermField, z.ZodType> = {
  leaseRef: z.string().trim().min(3).nullable(),
  landlord: text.nullable(),
  tenant: text.nullable(),
  guarantor: text.nullable(),
  premises: z.string().trim().min(5, 'is too short').nullable(),
  commencementDate: isoDate.nullable(),
  expiryDate: isoDate.nullable(),
  termMonths: count.nullable(),
  rentAmount: money.nullable(),
  rentFrequency: z.enum(['weekly', 'fortnightly', 'monthly', 'quarterly', 'annual']).nullable(),
  annualRent: money.nullable(),
  currency: z.enum(['NZD', 'AUD', 'GBP', 'USD']).nullable(),
  reviewMechanism: z.enum(['cpi', 'fixed', 'market', 'none']).nullable(),
  reviewPercent: z.preprocess(numeric, z.number().finite().nonnegative()).nullable(),
  reviewDates: z.array(isoDate).nullable(),
  outgoingsBasis: z.enum(['tenant_pays', 'proportion', 'landlord_pays']).nullable(),
  outgoingsAnnual: money.nullable(),
  bondAmount: money.nullable(),
  breakNoticeMonths: count.nullable(),
  breakDate: isoDate.nullable(),
  renewalTerms: count.nullable(),
  renewalTermMonths: count.nullable(),
  permittedUse: text.nullable(),
  makeGood: z.enum(['tenant_cost', 'fair_wear', 'none']).nullable(),
  insurance: z.enum(['tenant', 'landlord', 'both']).nullable(),
}

/** Checks raw values against the field schemas; a value that fails becomes null plus an issue. */
export function checkValues(raw: Record<string, unknown>): { values: LeaseTerms; issues: Issue[] } {
  const values: Record<string, unknown> = {}
  const issues: Issue[] = []
  for (const name of TERM_FIELDS) {
    let v = raw[name]
    if (v === undefined || v === '' || v === 'null' || v === 'N/A' || v === 'none' && name !== 'reviewMechanism' && name !== 'makeGood') v = null
    if (typeof v === 'string' && ['rentFrequency', 'currency', 'reviewMechanism', 'outgoingsBasis', 'makeGood', 'insurance'].includes(name)) {
      v = v.trim().toLowerCase().replace(/[\s-]+/g, '_')
      if (name === 'currency') v = (v as string).toUpperCase()
    }
    const parsed = VALUE_SCHEMAS[name].safeParse(v)
    if (parsed.success) values[name] = parsed.data ?? null
    else {
      values[name] = null
      issues.push({
        code: 'invalid_value',
        field: name,
        fields: [name],
        severity: 'error',
        message: `The ${FIELD_LABELS[name].toLowerCase()} read from the lease (${JSON.stringify(v)}) ${parsed.error.issues[0]?.message ?? 'is not valid'}.`,
      })
    }
  }
  return { values: values as unknown as LeaseTerms, issues }
}

const REQUIRED: Record<LeaseType, TermField[]> = {
  commercial: ['landlord', 'tenant', 'premises', 'commencementDate', 'expiryDate', 'rentAmount', 'rentFrequency', 'currency'],
  residential: ['landlord', 'tenant', 'premises', 'commencementDate', 'expiryDate', 'rentAmount', 'rentFrequency', 'currency', 'bondAmount'],
}

/** Weeks of rent the bond may not exceed without a warning: the statutory cap where there is one, otherwise eight. */
export const BOND_LIMIT_WEEKS: Record<Country, number> = { NZ: 4, AU: 4, UK: 5, US: 8 }

const weeklyRent = (t: LeaseTerms) => (t.rentAmount !== null && t.rentFrequency ? (t.rentAmount * PERIODS_PER_YEAR[t.rentFrequency]) / 52 : null)

export function validateTerms(t: LeaseTerms, country: Country, leaseType: LeaseType): Issue[] {
  const issues: Issue[] = []
  const push = (code: Issue['code'], field: TermField | '', fields: TermField[], severity: Issue['severity'], message: string) =>
    issues.push({ code, field, fields, severity, message })

  for (const f of REQUIRED[leaseType]) {
    if (t[f] === null || t[f] === undefined) push('missing_field', f, [f], 'error', `The ${FIELD_LABELS[f].toLowerCase()} was not found in the lease.`)
  }

  if (t.commencementDate && t.expiryDate && t.expiryDate <= t.commencementDate) {
    push('expiry_before_commencement', 'expiryDate', ['commencementDate', 'expiryDate'], 'error', `The expiry date (${t.expiryDate}) is not after the commencement date (${t.commencementDate}).`)
  }
  if (t.commencementDate && t.expiryDate && t.termMonths !== null && t.expiryDate > t.commencementDate) {
    const expected = addMonths(t.commencementDate, t.termMonths)
    const off = Math.abs(daysBetween(expected, t.expiryDate) + 1)
    if (off > 3) {
      push('term_disagrees_with_dates', 'termMonths', ['termMonths', 'commencementDate', 'expiryDate'], 'warning', `A term of ${t.termMonths} months from ${t.commencementDate} would end about ${addMonths(t.commencementDate, t.termMonths)}, not ${t.expiryDate}.`)
    }
  }
  if (t.reviewDates?.length && t.commencementDate && t.expiryDate) {
    const outside = t.reviewDates.filter((d) => d <= t.commencementDate! || d > t.expiryDate!)
    if (outside.length) push('review_outside_term', 'reviewDates', ['reviewDates'], 'warning', `Rent review date${outside.length > 1 ? 's' : ''} ${outside.join(', ')} fall${outside.length > 1 ? '' : 's'} outside the term (${t.commencementDate} to ${t.expiryDate}).`)
  }
  if (t.breakDate && t.commencementDate && t.expiryDate && (t.breakDate <= t.commencementDate || t.breakDate >= t.expiryDate)) {
    push('break_outside_term', 'breakDate', ['breakDate'], 'warning', `The earliest break date (${t.breakDate}) is outside the term.`)
  }
  if (t.rentAmount !== null && t.rentFrequency && t.annualRent !== null) {
    const expected = t.rentAmount * PERIODS_PER_YEAR[t.rentFrequency]
    if (Math.abs(expected - t.annualRent) > Math.max(1, t.annualRent * 0.005)) {
      push('annual_rent_disagrees', 'annualRent', ['annualRent', 'rentAmount', 'rentFrequency'], 'error', `${t.rentAmount} ${t.rentFrequency} comes to ${expected.toFixed(2)} a year, but the annual rent reads ${t.annualRent}.`)
    }
  }
  if (t.currency && t.currency !== COUNTRY_CURRENCY[country]) {
    push('currency_country_mismatch', 'currency', ['currency'], 'warning', `The currency (${t.currency}) is not the currency of the lease's country (${country}: ${COUNTRY_CURRENCY[country]}).`)
  }
  const weekly = weeklyRent(t)
  if (t.bondAmount !== null && weekly) {
    const weeks = t.bondAmount / weekly
    const limit = leaseType === 'residential' ? BOND_LIMIT_WEEKS[country] : 26
    if (weeks > limit + 0.05) {
      push('bond_over_limit', 'bondAmount', ['bondAmount'], 'warning', `The bond or deposit (${t.bondAmount.toFixed(2)}) is ${weeks.toFixed(1)} weeks of rent; ${leaseType === 'residential' ? `the usual limit in ${country} is ${limit} weeks` : 'more than six months of rent is unusual for a commercial lease'}.`)
    }
  }
  if (t.reviewPercent !== null && t.reviewMechanism !== 'fixed') {
    push('review_percent_without_fixed', 'reviewPercent', ['reviewPercent', 'reviewMechanism'], 'warning', `A fixed review percentage (${t.reviewPercent}%) was read, but the review mechanism is ${t.reviewMechanism ?? 'not stated'}.`)
  }
  if (t.renewalTerms && !t.renewalTermMonths) {
    push('renewal_without_term', 'renewalTermMonths', ['renewalTerms', 'renewalTermMonths'], 'warning', `${t.renewalTerms} renewal right${t.renewalTerms > 1 ? 's' : ''} read, but the length of the renewal term was not found.`)
  }
  return issues
}
