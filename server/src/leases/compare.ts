// Field equality after normalising, used to check the model against the rules (confidence), to spot a person's
// corrections, and by the evaluation. Names and addresses lose case and punctuation; money is compared in cents;
// dates must be the same ISO day; review dates as a sorted set.
import type { TermField } from './types'

const MONEY = new Set<string>(['rentAmount', 'annualRent', 'outgoingsAnnual', 'bondAmount'])
const NUMBER = new Set<string>(['termMonths', 'reviewPercent', 'breakNoticeMonths', 'renewalTerms', 'renewalTermMonths'])
const TEXT = new Set<string>(['landlord', 'tenant', 'guarantor', 'premises', 'permittedUse'])

const isBlank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

export const normaliseText = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(the|of|and|&)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) && v.trim() !== '' ? n : null
  }
  return null
}

/** The canonical form of a value, for comparing and for display of differences. */
export function canonical(field: TermField | string, value: unknown): unknown {
  if (isBlank(value)) return null
  if (MONEY.has(field)) {
    const n = toNumber(value)
    return n === null ? String(value) : Math.round(n * 100)
  }
  if (NUMBER.has(field)) {
    const n = toNumber(value)
    return n === null ? String(value) : Math.round(n * 100) / 100
  }
  if (TEXT.has(field)) return normaliseText(String(value))
  if (field === 'reviewDates') return Array.isArray(value) ? [...new Set(value.map(String))].sort() : [String(value)]
  if (field === 'leaseRef') return String(value).toUpperCase().replace(/\s+/g, '')
  if (typeof value === 'string') return value.trim().toLowerCase()
  return value
}

/** True when two values of a field are the same after normalising. For text fields, one containing the other counts. */
export function sameTermValue(field: TermField | string, a: unknown, b: unknown): boolean {
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b)
  const ca = canonical(field, a)
  const cb = canonical(field, b)
  if (TEXT.has(field) && typeof ca === 'string' && typeof cb === 'string') {
    const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca]
    return short.length >= 6 && long.includes(short)
  }
  return JSON.stringify(ca) === JSON.stringify(cb)
}
