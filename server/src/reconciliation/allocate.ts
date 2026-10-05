// The rent ledger: how money for a tenancy is applied to its weekly rent payments.
//
//   1. Money pays the tenancy's unpaid rent oldest first, for weeks due up to 6 days after the payment date
//      (a payment made on Friday for Monday's rent counts; older arrears are cleared first).
//   2. Whatever is left, if it is a whole number of weeks' rent, pays the following weeks in advance
//      (a fortnightly payer's second week).
//   3. Anything else is held as credit on the tenancy for a person to apply or refund.
//
// A week is paid only when it is fully covered; a part-paid week stays pending with the balance owing.
import { addDays, round2 } from './text'
import type { Allocation, LeaseRef, RentPayment } from './types'

export const POLICY = {
  /** Rent due up to this many days after a payment counts as due now. */
  windowAfterDays: 6,
  /** The amount rule looks for rent due up to this many days before the payment (paid late). */
  windowBeforeDays: 10,
}

export interface AllocationOutcome {
  allocations: Allocation[]
  /** Money left over: held as credit. */
  credit: number
  /** Rent still owing on weeks due by the payment date window, after this payment. */
  outstandingDue: number
}

const byDue = (a: RentPayment, b: RentPayment) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id
export const outstanding = (p: RentPayment) => round2(Math.max(0, p.amount - p.covered))

/** Applies money to one tenancy's payments. Mutates `covered` on the payments it pays. */
export function allocate(amount: number, date: string, weeklyRent: number, payments: RentPayment[]): AllocationOutcome {
  const sorted = [...payments].sort(byDue)
  const horizon = addDays(date, POLICY.windowAfterDays)
  let remaining = round2(amount)
  const allocations: Allocation[] = []

  const take = (p: RentPayment) => {
    const value = round2(Math.min(remaining, outstanding(p)))
    if (value <= 0) return
    p.covered = round2(p.covered + value)
    remaining = round2(remaining - value)
    allocations.push({ paymentId: p.id, dueDate: p.dueDate, amount: value, completes: outstanding(p) === 0 })
  }

  for (const p of sorted) {
    if (remaining <= 0) break
    if (p.dueDate <= horizon) take(p)
  }
  if (remaining > 0 && weeklyRent > 0) {
    const weeks = remaining / weeklyRent
    if (Math.round(weeks) >= 1 && Math.abs(weeks - Math.round(weeks)) < 1e-6) {
      for (const p of sorted) {
        if (remaining <= 0) break
        if (p.dueDate > horizon) take(p)
      }
    }
  }
  const outstandingDue = round2(sorted.filter((p) => p.dueDate <= horizon).reduce((s, p) => s + outstanding(p), 0))
  return { allocations, credit: remaining > 0 ? remaining : 0, outstandingDue }
}

/** Underpaid: less than a week's rent and rent due is left owing. Overpaid: money left over as credit. */
export function classifyRent(amount: number, weeklyRent: number, outcome: AllocationOutcome) {
  if (outcome.credit > 0) return { exception: 'overpaid' as const, shortfall: 0 }
  if (amount < weeklyRent - 0.005 && outcome.outstandingDue > 0) {
    return { exception: 'underpaid' as const, shortfall: round2(weeklyRent - amount) }
  }
  return { exception: null, shortfall: 0 }
}

export interface ReplayLine<K> {
  key: K
  date: string
  amount: number
  /** Tie-break for lines on the same date (file order). */
  order: number
}

export interface ReplayPayment {
  id: number
  leaseId: number
  dueDate: string
  amount: number
  /** Paid before any bank line was allocated to it (the opening balance, or recorded by hand). */
  opening: boolean
}

export interface ReplayResult<K> {
  perLine: Map<K, AllocationOutcome & { exception: 'underpaid' | 'overpaid' | null; shortfall: number }>
  payments: (RentPayment & { paidDate: string | null; opening: boolean })[]
}

/**
 * Rebuilds one tenancy's ledger from its bank lines in date order. The result doesn't depend on the order lines
 * were imported or decided in, so re-running it is always safe.
 */
export function replayLease<K>(weeklyRent: number, payments: ReplayPayment[], lines: ReplayLine<K>[]): ReplayResult<K> {
  const ledger = payments.map((p) => ({
    id: p.id,
    leaseId: p.leaseId,
    dueDate: p.dueDate,
    amount: p.amount,
    covered: p.opening ? p.amount : 0,
    paidDate: null as string | null,
    opening: p.opening,
  }))
  const perLine: ReplayResult<K>['perLine'] = new Map()
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
  for (const line of sorted) {
    const outcome = allocate(line.amount, line.date, weeklyRent, ledger)
    for (const a of outcome.allocations) {
      if (a.completes) ledger.find((p) => p.id === a.paymentId)!.paidDate = line.date
    }
    perLine.set(line.key, { ...outcome, ...classifyRent(line.amount, weeklyRent, outcome) })
  }
  return { perLine, payments: ledger }
}

export interface ArrearsWeek {
  paymentId: number
  dueDate: string
  amount: number
  paid: number
  outstanding: number
}

export interface ArrearsRow {
  leaseId: number
  tenant: string
  propertyCode: string | null
  address: string
  weeklyRent: number
  weeks: ArrearsWeek[]
  total: number
}

/** Rent due on or before `asOf` that isn't fully covered, per tenancy, largest first. */
export function computeArrears(leases: LeaseRef[], payments: RentPayment[], asOf: string): ArrearsRow[] {
  const rows: ArrearsRow[] = []
  for (const lease of leases) {
    const weeks = payments
      .filter((p) => p.leaseId === lease.id && p.dueDate <= asOf && outstanding(p) > 0)
      .sort(byDue)
      .map((p) => ({ paymentId: p.id, dueDate: p.dueDate, amount: p.amount, paid: round2(p.covered), outstanding: outstanding(p) }))
    if (weeks.length === 0) continue
    rows.push({
      leaseId: lease.id,
      tenant: `${lease.tenantFirstName} ${lease.tenantLastName}`,
      propertyCode: lease.propertyCode,
      address: lease.address,
      weeklyRent: lease.weeklyRent,
      weeks,
      total: round2(weeks.reduce((s, w) => s + w.outstanding, 0)),
    })
  }
  return rows.sort((a, b) => b.total - a.total || a.tenant.localeCompare(b.tenant))
}
