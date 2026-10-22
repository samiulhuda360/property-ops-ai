// The charge schedule: what the billing system should invoice, and when, for the first twelve months of a lease,
// derived from the abstracted terms. Bond on commencement, rent per period in advance, and the outgoings (service
// charge, CAM) estimate in monthly instalments when the tenant pays them.
import { PERIODS_PER_YEAR, type Charge, type LeaseTerms } from './types'

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`)

export function addDays(iso: string, days: number): string {
  const d = parse(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

/** Adds calendar months, clamping to the last day of the target month (31 January + 1 month = 28 February). */
export function addMonths(iso: string, months: number): string {
  const d = parse(iso)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return toIso(d)
}

/** Days between two ISO dates (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000)

const round2 = (n: number) => Math.round(n * 100) / 100

const PERIOD_LABEL: Record<string, string> = { weekly: 'Week', fortnightly: 'Fortnight', monthly: 'Month', quarterly: 'Quarter', annual: 'Year' }

/** The next due date after `from` for a frequency (months for monthly and longer, days for weekly and fortnightly). */
export function nextDue(commencement: string, frequency: keyof typeof PERIODS_PER_YEAR, index: number): string {
  switch (frequency) {
    case 'weekly':
      return addDays(commencement, 7 * index)
    case 'fortnightly':
      return addDays(commencement, 14 * index)
    case 'monthly':
      return addMonths(commencement, index)
    case 'quarterly':
      return addMonths(commencement, 3 * index)
    case 'annual':
      return addMonths(commencement, 12 * index)
  }
}

/**
 * The charges for the first `months` months of the term (default twelve), or to the expiry date when the term is
 * shorter. Returns [] when the terms needed (commencement, rent, frequency, currency) are missing.
 */
export function scheduleCharges(t: LeaseTerms, months = 12): Charge[] {
  if (!t.commencementDate || t.rentAmount === null || !t.rentFrequency || !t.currency) return []
  const start = t.commencementDate
  const windowEnd = addMonths(start, months)
  const end = t.expiryDate && t.expiryDate < windowEnd ? addDays(t.expiryDate, 1) : windowEnd
  const charges: Charge[] = []
  if (t.bondAmount) {
    charges.push({ kind: 'bond', description: 'Bond / security deposit', amount: round2(t.bondAmount), currency: t.currency, dueDate: start, period: 'one-off' })
  }
  for (let i = 0; ; i++) {
    const due = nextDue(start, t.rentFrequency, i)
    if (due >= end) break
    const periodEnd = addDays(nextDue(start, t.rentFrequency, i + 1), -1)
    charges.push({
      kind: 'rent',
      description: `Rent, ${PERIOD_LABEL[t.rentFrequency].toLowerCase()} ${i + 1}`,
      amount: round2(t.rentAmount),
      currency: t.currency,
      dueDate: due,
      period: `${due} to ${periodEnd > addDays(end, -1) ? addDays(end, -1) : periodEnd}`,
    })
  }
  if ((t.outgoingsBasis === 'tenant_pays' || t.outgoingsBasis === 'proportion') && t.outgoingsAnnual) {
    const instalment = round2(t.outgoingsAnnual / 12)
    for (let i = 0; ; i++) {
      const due = addMonths(start, i)
      if (due >= end) break
      charges.push({
        kind: 'outgoings',
        description: `Outgoings instalment, month ${i + 1}`,
        amount: instalment,
        currency: t.currency,
        dueDate: due,
        period: `${due} to ${addDays(addMonths(start, i + 1), -1)}`,
      })
    }
  }
  return charges.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.kind.localeCompare(b.kind))
}
