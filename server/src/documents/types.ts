// Shared shapes for document extraction: the fields of each document kind, per-field confidence, and issues.

export type DocumentKind = 'invoice' | 'lease'
export type Method = 'rules' | 'llm' | 'llm+validation'
export type Confidence = 'high' | 'medium' | 'low'
export type Severity = 'error' | 'warning' | 'info'

export interface LineItem {
  description: string
  quantity: number | null
  unitAmount: number | null
  amount: number
}

/** Money is in dollars (two decimals), dates are ISO (YYYY-MM-DD). */
export interface InvoiceFields {
  supplierName: string | null
  supplierGstNumber: string | null
  supplierBankAccount: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  propertyAddress: string | null
  lineItems: LineItem[] | null
  subtotal: number | null
  gst: number | null
  total: number | null
}

export type RentFrequency = 'weekly' | 'fortnightly' | 'monthly'

export interface LeaseFields {
  tenantNames: string[] | null
  propertyAddress: string | null
  startDate: string | null
  /** An ISO date, or "periodic" when the tenancy has no end date. */
  endDate: string | null
  weeklyRent: number | null
  bond: number | null
  rentFrequency: RentFrequency | null
  petsAllowed: boolean | null
  maxOccupants: number | null
}

export type Fields = InvoiceFields | LeaseFields

export const INVOICE_FIELDS = [
  'supplierName',
  'supplierGstNumber',
  'supplierBankAccount',
  'invoiceNumber',
  'invoiceDate',
  'dueDate',
  'propertyAddress',
  'lineItems',
  'subtotal',
  'gst',
  'total',
] as const satisfies readonly (keyof InvoiceFields)[]

export const LEASE_FIELDS = [
  'tenantNames',
  'propertyAddress',
  'startDate',
  'endDate',
  'weeklyRent',
  'bond',
  'rentFrequency',
  'petsAllowed',
  'maxOccupants',
] as const satisfies readonly (keyof LeaseFields)[]

export const fieldNames = (kind: DocumentKind): readonly string[] => (kind === 'invoice' ? INVOICE_FIELDS : LEASE_FIELDS)

/** Where a value came from: the rules, the model, the model's second look after validation, or a person. */
export type FieldSource = 'rules' | 'llm' | 'llm-repair' | 'person'

/** What is stored per field in Document.extracted. */
export interface ExtractedField {
  value: unknown
  confidence: Confidence
  source: FieldSource
}

export type IssueCode =
  | 'no_text'
  | 'model_unavailable'
  | 'missing_field'
  | 'invalid_value'
  | 'gst_not_3_23'
  | 'totals_dont_add'
  | 'line_items_dont_add'
  | 'gst_number_invalid'
  | 'gst_number_missing'
  | 'gst_number_differs'
  | 'bank_account_differs'
  | 'due_before_invoice'
  | 'supplier_unknown'
  | 'supplier_mismatch'
  | 'property_unknown'
  | 'job_not_found'
  | 'job_not_completed'
  | 'over_quote'
  | 'duplicate_invoice'
  | 'lease_not_found'
  | 'lease_ended'
  | 'tenant_differs'
  | 'rent_differs'
  | 'bond_differs'
  | 'bond_over_four_weeks'
  | 'end_before_start'
  | 'rejected'

export interface Issue {
  code: IssueCode
  /** The main field the issue is about ('' when it is about the whole document). */
  field: string
  /** Every field the issue puts in doubt (drives field confidence). */
  fields: string[]
  message: string
  severity: Severity
}

/** Records the document was matched to. */
export interface Links {
  propertyId: number | null
  contractorId: number | null
  maintenanceRequestId: number | null
  leaseId: number | null
}

export const NO_LINKS: Links = { propertyId: null, contractorId: null, maintenanceRequestId: null, leaseId: null }

/** Issues a person should look at (info notes are context, not alarms). */
export const isAlarm = (issue: Pick<Issue, 'severity'>) => issue.severity !== 'info'
