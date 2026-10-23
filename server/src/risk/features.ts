// Arrears-risk features from a tenancy's monthly rent history. The definitions match server/ml/arrears.py exactly,
// so the Node server reproduces the Python model's probabilities from the exported weights (test/risk-model.test.ts
// checks this to 1e-6).

export const FEATURE_NAMES = [
  'late_share_6',
  'avg_days_late_6',
  'late_trend',
  'partial_count_6',
  'missed_count_12',
  'max_days_late_12',
  'prior_arrears',
  'tenancy_months',
  'rent_ratio',
  'balance_ratio',
] as const
export type FeatureName = (typeof FEATURE_NAMES)[number]
export type Features = Record<FeatureName, number>

export interface MonthRow {
  month: string // YYYY-MM
  rentDue: number
  paidAmount: number
  daysLate: number
  arrears30: boolean
}

export interface TenancyHistory {
  /** The lease start date (YYYY-MM-DD or a Date). */
  start: string | Date
  rentMonthly: number
  marketMonthly: number | null
  rows: MonthRow[]
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

const monthIndex = (ym: string) => {
  const [y, m] = ym.slice(0, 7).split('-').map(Number)
  return y * 12 + m
}

/** The monthly rent for a weekly rent, as the app stores rents weekly. */
export const monthlyRent = (weekly: number) => Math.round((weekly * 52) / 12 * 100) / 100

/** The features as of a cutoff month (YYYY-MM): only rows at or before it count. */
export function computeFeatures(history: TenancyHistory, cutoff: string): Features {
  const rows = history.rows.filter((r) => r.month <= cutoff).sort((a, b) => (a.month < b.month ? -1 : 1))
  const n = rows.length
  const last6 = rows.slice(-6)
  const last12 = rows.slice(-12)
  const last3 = rows.slice(-3)
  const before3 = rows.slice(0, Math.max(0, n - 3)).slice(-3)

  const startIso = typeof history.start === 'string' ? history.start : history.start.toISOString()
  const months = monthIndex(cutoff) - monthIndex(startIso) + 1
  const shortfall = rows.reduce((s, r) => s + (r.rentDue - r.paidAmount), 0)

  return {
    late_share_6: n ? last6.filter((r) => r.daysLate > 0).length / Math.min(6, n) : 0,
    avg_days_late_6: mean(last6.map((r) => r.daysLate)),
    late_trend: n < 4 ? 0 : mean(last3.map((r) => r.daysLate)) - mean(before3.map((r) => r.daysLate)),
    partial_count_6: last6.filter((r) => r.paidAmount > 0 && r.paidAmount < r.rentDue).length,
    missed_count_12: last12.filter((r) => r.paidAmount === 0).length,
    max_days_late_12: last12.length ? Math.max(...last12.map((r) => r.daysLate)) : 0,
    prior_arrears: rows.some((r) => r.arrears30) ? 1 : 0,
    tenancy_months: Math.min(60, Math.max(1, months)),
    rent_ratio: history.marketMonthly ? history.rentMonthly / history.marketMonthly : 1,
    balance_ratio: Math.max(0, shortfall) / history.rentMonthly,
  }
}
