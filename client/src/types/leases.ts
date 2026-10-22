export type LeaseStatus = 'needs_review' | 'approved' | 'rejected'
export type Route = 'rules' | 'llm' | 'hybrid'
export type Confidence = 'high' | 'medium' | 'low'
export type FieldSource = 'rules' | 'llm' | 'llm-repair' | 'person'
export type FieldStatus = 'extracted' | 'needs_person' | 'approved' | 'corrected'
export type IssueSeverity = 'error' | 'warning' | 'info'
export type RiskStatus = 'open' | 'accepted' | 'dismissed'
export type ReconciliationStatus = 'matched' | 'amount_differs' | 'missing' | 'unexpected'

export interface ExtractedTerm {
  value: unknown
  page: number | null
  quote: string | null
  confidence: Confidence
  source: FieldSource
  status: FieldStatus
}

export interface LeaseIssue {
  code: string
  field: string
  fields: string[]
  message: string
  severity: IssueSeverity
}

export interface RiskFinding {
  code: string
  title: string
  severity: 'high' | 'medium' | 'low'
  explanation: string
  page: number | null
  quote: string | null
  status: RiskStatus
}

export interface Charge {
  kind: 'rent' | 'outgoings' | 'bond'
  description: string
  amount: number
  currency: string
  dueDate: string
  period: string
}

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

export interface LeaseRecord {
  id: number
  fileName: string
  country: string | null
  leaseType: string | null
  route: Route
  leaseRef: string | null
  terms: Record<string, ExtractedTerm>
  issues: LeaseIssue[]
  risks: RiskFinding[]
  charges?: Charge[]
  reconciliation: Reconciliation | null
  pages?: PageText[]
  status: LeaseStatus
  reviewedAt: string | null
  reviewSeconds: number | null
  createdAt: string
  propertyId: number | null
  property?: { id: number; code: string | null; address: string; suburb: string } | null
}

export interface LeaseMethodInfo {
  route: Route
  aiEnabled: boolean
  model: string | null
  fields: { key: string; label: string }[]
}

export interface SampleLease {
  file: string
  title: string
  country: string
  leaseType: string
  available: boolean
}

export interface AuditEvent {
  id: number
  action: string
  field: string | null
  before: unknown
  after: unknown
  note: string | null
  createdAt: string
  user: { name: string; email: string }
}
