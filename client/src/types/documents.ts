export type DocumentKind = 'invoice' | 'lease'
export type DocumentStatus = 'needs_review' | 'approved' | 'exported' | 'rejected'
export type ExtractionMethod = 'rules' | 'llm' | 'llm+validation'
export type Confidence = 'high' | 'medium' | 'low'
export type FieldSource = 'rules' | 'llm' | 'llm-repair' | 'person'
export type IssueSeverity = 'error' | 'warning' | 'info'

export interface ExtractedField {
  value: unknown
  confidence: Confidence
  source: FieldSource
}

export interface DocumentIssue {
  code: string
  field: string
  fields: string[]
  message: string
  severity: IssueSeverity
}

export interface LineItem {
  description: string
  quantity: number | null
  unitAmount: number | null
  amount: number
}

export interface DocumentRecord {
  id: number
  kind: DocumentKind
  fileName: string
  method: ExtractionMethod
  status: DocumentStatus
  extracted: Record<string, ExtractedField>
  issues: DocumentIssue[]
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  total: number | null
  gst: number | null
  reviewedAt: string | null
  reviewSeconds: number | null
  createdAt: string
  propertyId: number | null
  contractorId: number | null
  maintenanceRequestId: number | null
  leaseId: number | null
  property?: { id: number; code: string | null; address: string; suburb: string } | null
  contractor?: { id: number; name: string; trade: string; gstNumber: string | null; bankAccount: string | null } | null
  maintenanceRequest?: { id: number; title: string; status: string; quoteAmount: number | null } | null
  lease?: {
    id: number
    weeklyRent: number
    bondAmount: number
    startDate: string
    endDate: string | null
    status: string
    tenant: { firstName: string; lastName: string }
  } | null
  text?: string
}

export interface MethodInfo {
  method: ExtractionMethod
  aiEnabled: boolean
  model: string | null
}

export interface ApproveResult {
  document: DocumentRecord
  changedFields: string[]
}

export interface DraftBill {
  id: string
  status: string
  contactName: string
  invoiceNumber: string
  total: number
  pushedAt: string
}

export interface PushResult {
  document: DocumentRecord
  bill: DraftBill
  adapter: string
}
