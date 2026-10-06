// Rent reconciliation: what the API returns for imported bank statements.

export type ExceptionCode =
  | 'underpaid'
  | 'overpaid'
  | 'duplicate'
  | 'unknown_payer'
  | 'ambiguous'
  | 'payment_to_ended_lease'
  | 'no_matching_job'
  | 'amount_differs_from_quote'

export type MatchStatus = 'matched' | 'exception' | 'ignored' | 'unmatched'
export type Decision = 'accept' | 'reassign' | 'ignore'
export type StatusFilter = 'all' | 'exception' | 'matched' | 'ignored' | 'resolved'

export interface Allocation {
  paymentId: number
  dueDate: string
  amount: number
  completes: boolean
}

export interface Candidate {
  kind: 'lease' | 'job'
  id: number
  label: string
  why: string
}

export interface AiSuggestion {
  status: 'ok' | 'invalid' | 'failed'
  tenancy: string | null
  leaseId: number | null
  category: string
  confidence: number
  reason: string
  model: string
  cached: boolean
  at: string
  error?: string
}

export interface Resolution {
  decision: Decision
  leaseId: number | null
  jobId: number | null
  note: string | null
  reviewSeconds: number
  outcome: 'reviewed' | 'corrected' | 'rejected'
  at: string
}

export interface BankLine {
  id: number
  batch: string
  row: number
  date: string
  amount: number
  payee: string
  particulars: string
  code: string
  reference: string
  tranType: string
  matchStatus: MatchStatus
  matchType: string | null
  category: string | null
  exception: ExceptionCode | null
  exceptionLabel: string | null
  method: string
  methodLabel: string
  confidence: number
  lease: { id: number; label: string; tenant: string; propertyCode: string | null; address: string; ended: boolean } | null
  job: { id: number; label: string; quoteAmount: number | null } | null
  contractor: { id: number; name: string } | null
  allocations: Allocation[]
  credit: number
  shortfall: number
  explanation: string
  suggestedAction: string | null
  candidates: Candidate[]
  duplicateOf: string | null
  aiSuggestion: AiSuggestion | null
  resolution: Resolution | null
  engine: { matchStatus: string; matchType: string | null; exception: ExceptionCode | null; leaseId: number | null; jobId: number | null }
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

export interface BatchSummary {
  batch: string
  fileName: string
  period: { start: string; end: string }
  importedAt: string
  lines: number
  moneyIn: number
  moneyOut: number
  matched: { automatically: number; afterReview: number; total: number; percent: number }
  ignored: number
  exceptions: {
    open: number
    resolved: number
    byReason: { reason: ExceptionCode; label: string; open: number; resolved: number; amount: number }[]
  }
  byType: Record<string, number>
  arrears: { asOf: string; total: number; tenants: ArrearsRow[] }
  credits: { total: number; tenants: { leaseId: number; tenant: string; propertyCode: string | null; amount: number }[] }
  method: { label: string; rules: true; model: { enabled: boolean; name: string | null; suggestions: number } }
}

export interface BatchInfo {
  batch: string
  fileName: string
  periodStart: string
  periodEnd: string
  lines: number
  openExceptions: number
  importedAt: string
}

export interface ImportResult {
  batch: string
  fileName: string
  alreadyImported: boolean
  lines: number
  newLines: number
  skippedLines: number
  matched: number
  exceptions: number
  suggestions: number
  method: 'rules' | 'rules+model'
  errors: { line: number; message: string }[]
}

export interface ResolveInput {
  decision: Decision
  leaseId?: number
  jobId?: number
  note?: string
  reviewSeconds: number
}

/** The parts of a lease the reassign picker needs (from GET /api/leases). */
export interface LeaseOption {
  id: number
  status: string
  weeklyRent: number
  rentReference?: string | null
  tenant?: { firstName: string; lastName: string }
  property?: { address: string; code?: string | null }
}

/** The parts of a maintenance job the job picker needs (from GET /api/maintenance). */
export interface JobOption {
  id: number
  title: string
  status: string
  quoteAmount?: number | null
  contractorId?: number | null
  property?: { address: string; code?: string | null }
}
