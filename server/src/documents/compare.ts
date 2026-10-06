// Field equality after normalising: dates as ISO, money in cents, addresses without case or punctuation.
// Used to check the model against the rules (confidence), to spot a person's corrections, and by the evaluation.
import { sameAddress } from './address'
import { digitsOnly, normaliseCompany, normaliseInvoiceNumber, normalisePersonName, parseDate, parseMoney, toCents } from './parse'

const MONEY_FIELDS = new Set(['subtotal', 'gst', 'total', 'weeklyRent', 'bond'])
const DATE_FIELDS = new Set(['invoiceDate', 'dueDate', 'startDate'])

const isBlank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

function amounts(items: unknown): number[] {
  if (!Array.isArray(items)) return []
  return items
    .map((i) => parseMoney((i as { amount?: unknown })?.amount))
    .filter((n): n is number => n !== null)
    .map(toCents)
    .sort((a, b) => a - b)
}

function names(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s*(?:,|&|\band\b)\s*/) : []
  return list
    .map((n) => normalisePersonName(String(n)))
    .filter(Boolean)
    .sort()
}

/** The canonical form of a value, for comparing and for display of differences. */
export function canonical(field: string, value: unknown): unknown {
  if (isBlank(value)) return null
  if (MONEY_FIELDS.has(field)) {
    const n = parseMoney(value)
    return n === null ? String(value) : toCents(n)
  }
  if (DATE_FIELDS.has(field)) return parseDate(String(value)) ?? String(value)
  switch (field) {
    case 'endDate':
      return /periodic/i.test(String(value)) ? 'periodic' : (parseDate(String(value)) ?? String(value))
    case 'supplierName':
      return normaliseCompany(String(value))
    case 'supplierGstNumber':
    case 'supplierBankAccount':
      return digitsOnly(String(value))
    case 'invoiceNumber':
      return normaliseInvoiceNumber(String(value))
    case 'lineItems':
      return amounts(value)
    case 'tenantNames':
      return names(value)
    case 'rentFrequency':
      return String(value).toLowerCase()
    case 'maxOccupants':
      return Number(value)
    default:
      return value
  }
}

/** True when two values of a field are the same after normalising. */
export function sameFieldValue(field: string, a: unknown, b: unknown): boolean {
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b)
  if (field === 'propertyAddress') return sameAddress(String(a), String(b))
  return JSON.stringify(canonical(field, a)) === JSON.stringify(canonical(field, b))
}
