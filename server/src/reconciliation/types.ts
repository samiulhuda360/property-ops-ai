// Types shared by the reconciliation parser, engine, database layer and export.

export type MatchType = 'rent' | 'contractor' | 'bond' | 'refund' | 'fee' | 'transfer' | 'other'

export const EXCEPTION_CODES = [
  'underpaid',
  'overpaid',
  'duplicate',
  'unknown_payer',
  'ambiguous',
  'payment_to_ended_lease',
  'no_matching_job',
  'amount_differs_from_quote',
] as const
export type ExceptionCode = (typeof EXCEPTION_CODES)[number]

export const EXCEPTION_LABELS: Record<ExceptionCode, string> = {
  underpaid: 'Underpaid',
  overpaid: 'Overpaid',
  duplicate: 'Possible duplicate',
  unknown_payer: 'Unknown payer',
  ambiguous: 'Ambiguous',
  payment_to_ended_lease: 'Payment to an ended tenancy',
  no_matching_job: 'No matching job',
  amount_differs_from_quote: 'Amount differs from quote',
}

/** How a line was matched: which rule decided, or a person. */
export type MatchMethod = 'reference' | 'payer_name' | 'amount_window' | 'contractor' | 'keyword' | 'duplicate' | 'none' | 'person'

export const METHOD_LABELS: Record<MatchMethod, string> = {
  reference: 'Reference',
  payer_name: 'Payer name',
  amount_window: 'Amount and date',
  contractor: 'Contractor and job',
  keyword: 'Category keyword',
  duplicate: 'Duplicate check',
  none: 'No match',
  person: 'Decided by a person',
}

/** One line of a bank statement, as parsed from the CSV. */
export interface StatementLine {
  /** 1-based position among the file's data rows. */
  row: number
  /** yyyy-mm-dd */
  date: string
  /** Money in is positive, money out is negative. */
  amount: number
  payee: string
  particulars: string
  code: string
  reference: string
  tranType: string
}

export interface PropertyRef {
  id: number
  code: string | null
  address: string
  suburb: string
}

export interface LeaseRef {
  id: number
  propertyId: number
  propertyCode: string | null
  address: string
  suburb: string
  tenantFirstName: string
  tenantLastName: string
  weeklyRent: number
  rentReference: string | null
  status: string
  startDate: string
  endDate: string | null
}

/** A weekly rent payment row and how much money is already allocated to it. */
export interface RentPayment {
  id: number
  leaseId: number
  dueDate: string
  amount: number
  covered: number
}

export interface ContractorRef {
  id: number
  name: string
  trade: string
}

export interface JobRef {
  id: number
  contractorId: number | null
  propertyId: number
  propertyCode: string | null
  address: string
  title: string
  quoteAmount: number | null
  cost: number | null
  status: string
}

/** A line imported earlier, for duplicate detection and refund pairing. */
export interface PriorLine {
  key: string
  label: string
  date: string
  amount: number
  leaseId: number | null
  exception: string | null
}

/** Everything the engine needs to know about the portfolio. Built from the database or from truth.json. */
export interface Snapshot {
  properties: PropertyRef[]
  leases: LeaseRef[]
  payments: RentPayment[]
  contractors: ContractorRef[]
  jobs: JobRef[]
  priorLines: PriorLine[]
}

export interface Allocation {
  paymentId: number
  dueDate: string
  amount: number
  /** This allocation finished paying the week. */
  completes: boolean
}

export interface Candidate {
  kind: 'lease' | 'job'
  id: number
  label: string
  why: string
}

/** What the engine decided for one line. */
export interface LineResult {
  row: number
  matchStatus: 'matched' | 'exception'
  matchType: MatchType | null
  exception: ExceptionCode | null
  method: MatchMethod
  /** 0 to 1: how sure the rule is. */
  confidence: number
  leaseId: number | null
  propertyId: number | null
  contractorId: number | null
  jobId: number | null
  /** fee, bond, transfer, interest, refund, contractor_credit */
  category: string | null
  /** The money counts towards the tenancy's rent. */
  allocatable: boolean
  allocations: Allocation[]
  /** Money held on the tenancy beyond the rent due (an overpayment). */
  credit: number
  /** How far a payment fell short of the weekly rent. */
  shortfall: number
  explanation: string
  suggestedAction: string | null
  candidates: Candidate[]
  duplicateOf: string | null
}
