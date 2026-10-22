// Shared shapes for lease abstraction: the key terms of a commercial or residential lease from New Zealand,
// Australia, the United Kingdom or the United States, each carrying where it was read (page and quote) and how sure
// the reader is; the checks, the risk findings, the charge schedule and the reconciliation against issued invoices.

export type Country = 'NZ' | 'AU' | 'UK' | 'US'
export type Currency = 'NZD' | 'AUD' | 'GBP' | 'USD'
export type LeaseType = 'commercial' | 'residential'
export type Route = 'rules' | 'llm' | 'hybrid'
export type Confidence = 'high' | 'medium' | 'low'
export type Severity = 'error' | 'warning' | 'info'
export type FieldSource = 'rules' | 'llm' | 'llm-repair' | 'person'
export type FieldStatus = 'extracted' | 'needs_person' | 'approved' | 'corrected'

export type RentFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'
export type ReviewMechanism = 'cpi' | 'fixed' | 'market' | 'none'
export type OutgoingsBasis = 'tenant_pays' | 'proportion' | 'landlord_pays'
export type MakeGood = 'tenant_cost' | 'fair_wear' | 'none'
export type InsuranceParty = 'tenant' | 'landlord' | 'both'

export const COUNTRY_CURRENCY: Record<Country, Currency> = { NZ: 'NZD', AU: 'AUD', UK: 'GBP', US: 'USD' }
export const PERIODS_PER_YEAR: Record<RentFrequency, number> = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, annual: 1 }

/** Money is in the lease's currency (two decimals); dates are ISO (YYYY-MM-DD). */
export interface LeaseTerms {
  leaseRef: string | null
  landlord: string | null
  tenant: string | null
  guarantor: string | null
  premises: string | null
  commencementDate: string | null
  expiryDate: string | null
  termMonths: number | null
  rentAmount: number | null
  rentFrequency: RentFrequency | null
  annualRent: number | null
  currency: Currency | null
  reviewMechanism: ReviewMechanism | null
  reviewPercent: number | null
  reviewDates: string[] | null
  outgoingsBasis: OutgoingsBasis | null
  outgoingsAnnual: number | null
  bondAmount: number | null
  breakNoticeMonths: number | null
  breakDate: string | null
  renewalTerms: number | null
  renewalTermMonths: number | null
  permittedUse: string | null
  makeGood: MakeGood | null
  insurance: InsuranceParty | null
}

export const TERM_FIELDS = [
  'leaseRef',
  'landlord',
  'tenant',
  'guarantor',
  'premises',
  'commencementDate',
  'expiryDate',
  'termMonths',
  'rentAmount',
  'rentFrequency',
  'annualRent',
  'currency',
  'reviewMechanism',
  'reviewPercent',
  'reviewDates',
  'outgoingsBasis',
  'outgoingsAnnual',
  'bondAmount',
  'breakNoticeMonths',
  'breakDate',
  'renewalTerms',
  'renewalTermMonths',
  'permittedUse',
  'makeGood',
  'insurance',
] as const satisfies readonly (keyof LeaseTerms)[]

export type TermField = (typeof TERM_FIELDS)[number]

export const FIELD_LABELS: Record<TermField, string> = {
  leaseRef: 'Lease reference',
  landlord: 'Landlord',
  tenant: 'Tenant',
  guarantor: 'Guarantor',
  premises: 'Premises',
  commencementDate: 'Commencement date',
  expiryDate: 'Expiry date',
  termMonths: 'Term (months)',
  rentAmount: 'Rent per period',
  rentFrequency: 'Rent frequency',
  annualRent: 'Annual rent',
  currency: 'Currency',
  reviewMechanism: 'Rent review mechanism',
  reviewPercent: 'Fixed review (%)',
  reviewDates: 'Rent review dates',
  outgoingsBasis: 'Outgoings / service charge / CAM',
  outgoingsAnnual: 'Outgoings estimate (annual)',
  bondAmount: 'Bond / deposit',
  breakNoticeMonths: 'Break notice (months)',
  breakDate: 'Earliest break date',
  renewalTerms: 'Renewal rights (number)',
  renewalTermMonths: 'Renewal term (months)',
  permittedUse: 'Permitted use',
  makeGood: 'Make good / reinstatement',
  insurance: 'Insurance obligation',
}

/** One extracted term: the value, where it was read, and how sure the reader is. */
export interface ExtractedTerm {
  value: unknown
  /** 1-based page the value was read from; null when it could not be located. */
  page: number | null
  /** The text of the lease the value was read from, as printed. */
  quote: string | null
  confidence: Confidence
  source: FieldSource
  status: FieldStatus
}

export type ExtractedTerms = Record<TermField, ExtractedTerm>

export type IssueCode =
  | 'no_text'
  | 'model_unavailable'
  | 'missing_field'
  | 'invalid_value'
  | 'expiry_before_commencement'
  | 'term_disagrees_with_dates'
  | 'review_outside_term'
  | 'break_outside_term'
  | 'annual_rent_disagrees'
  | 'currency_country_mismatch'
  | 'bond_over_limit'
  | 'review_percent_without_fixed'
  | 'renewal_without_term'
  | 'rules_disagree'
  | 'rejected'

export interface Issue {
  code: IssueCode
  field: string
  /** Every field the issue puts in doubt (drives field confidence and the "needs a person" status). */
  fields: string[]
  message: string
  severity: Severity
}

export const isAlarm = (issue: Pick<Issue, 'severity'>) => issue.severity !== 'info'

export type RiskStatus = 'open' | 'accepted' | 'dismissed'

export interface RiskFinding {
  code: string
  title: string
  severity: 'high' | 'medium' | 'low'
  explanation: string
  page: number | null
  quote: string | null
  status: RiskStatus
}

export type ChargeKind = 'rent' | 'outgoings' | 'bond'

export interface Charge {
  kind: ChargeKind
  description: string
  amount: number
  currency: Currency
  dueDate: string
  /** The period the charge covers, e.g. "2026-03-01 to 2026-03-31" or "one-off". */
  period: string
}

export type ReconciliationStatus = 'matched' | 'amount_differs' | 'missing' | 'unexpected'

export interface ReconciliationLine {
  status: ReconciliationStatus
  expected: Charge | null
  invoice: { id: number; invoiceNumber: string; row: number; kind: string; amount: number; currency: string; dueDate: string; description: string } | null
  difference: number | null
  note: string
}

export interface Reconciliation {
  leaseRef: string | null
  lines: ReconciliationLine[]
  counts: Record<ReconciliationStatus, number>
}

export interface PageText {
  num: number
  text: string
}
