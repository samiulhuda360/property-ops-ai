// Business validation: the checks a person would make before approving, run on whatever was extracted.
// Arithmetic (GST is 3/23 of the total, lines add up), GST number check digit, dates, and links to the records:
// supplier, property, maintenance job and quote, duplicates, and for tenancy summaries the lease's rent and bond.
import { isValidIrdNumber } from '../lib/ird'
import { matchProperty, type PropertyRef } from './address'
import {
  digitsOnly,
  editDistance,
  formatDate,
  formatMoney,
  normaliseCompany,
  normaliseInvoiceNumber,
  normalisePersonName,
  toCents,
} from './parse'
import type { DocumentKind, Fields, InvoiceFields, Issue, IssueCode, LeaseFields, Links, Severity } from './types'

export interface ContractorRef {
  id: number
  name: string
  trade: string
  gstNumber: string | null
  bankAccount: string | null
  email: string | null
}
export interface JobRef {
  id: number
  propertyId: number
  contractorId: number | null
  title: string
  status: string
  quoteAmount: number | null
}
export interface LeaseRef {
  id: number
  propertyId: number
  tenantNames: string[]
  weeklyRent: number
  bondAmount: number
  startDate: string
  endDate: string | null
  status: string
}
export interface InvoiceRef {
  documentId: number | null
  contractorId: number | null
  supplierName: string | null
  invoiceNumber: string
}

/** Everything the checks compare against, loaded once per document (or once per evaluation run). */
export interface ReferenceData {
  properties: PropertyRef[]
  contractors: ContractorRef[]
  jobs: JobRef[]
  leases: LeaseRef[]
  /** Invoices already in the system, for the duplicate check. */
  invoices: InvoiceRef[]
}

export interface ValidationResult {
  issues: Issue[]
  links: Links
}

/** Suppliers that bill without a maintenance job. */
const NO_JOB_TRADES = new Set(['insurance', 'utilities'])
/** Two cents either way, for rounding on the document. */
const TOLERANCE_CENTS = 2
const QUOTE_ALLOWANCE = 0.1

export const FIELD_LABELS: Record<string, string> = {
  supplierName: 'supplier name',
  supplierGstNumber: 'GST number',
  supplierBankAccount: 'bank account',
  invoiceNumber: 'invoice number',
  invoiceDate: 'invoice date',
  dueDate: 'due date',
  propertyAddress: 'property address',
  lineItems: 'line items',
  subtotal: 'subtotal',
  gst: 'GST amount',
  total: 'total',
  tenantNames: 'tenant names',
  startDate: 'start date',
  endDate: 'end date',
  weeklyRent: 'weekly rent',
  bond: 'bond',
  rentFrequency: 'rent frequency',
  petsAllowed: 'pets allowed',
  maxOccupants: 'maximum occupants',
}

class Collector {
  issues: Issue[] = []
  add(code: IssueCode, severity: Severity, fields: string[], message: string) {
    this.issues.push({ code, field: fields[0] ?? '', fields, message, severity })
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Matching

export function matchContractor(
  name: string | null,
  gstNumber: string | null,
  contractors: ContractorRef[],
): { byName: ContractorRef | null; byGst: ContractorRef | null } {
  const digits = gstNumber ? digitsOnly(gstNumber) : ''
  const byGst = digits.length >= 8 ? (contractors.find((c) => c.gstNumber && digitsOnly(c.gstNumber) === digits) ?? null) : null
  let byName: ContractorRef | null = null
  if (name) {
    const wanted = normaliseCompany(name)
    byName =
      contractors.find((c) => normaliseCompany(c.name) === wanted) ??
      contractors.find((c) => {
        const have = normaliseCompany(c.name)
        return have.length >= 6 && editDistance(have, wanted) <= 2
      }) ??
      null
  }
  return { byName, byGst }
}

function bestJob(jobs: JobRef[], description: string): JobRef {
  if (jobs.length === 1) return jobs[0]
  const words = new Set(description.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3))
  const score = (j: JobRef) => j.title.toLowerCase().split(/[^a-z]+/).filter((w) => words.has(w)).length
  return [...jobs].sort((a, b) => score(b) - score(a) || b.id - a.id)[0]
}

const tenantMatches = (names: string[], lease: LeaseRef) =>
  names.some((n) =>
    lease.tenantNames.some((t) => {
      const a = normalisePersonName(n)
      const b = normalisePersonName(t)
      return a === b || editDistance(a, b) <= 2
    }),
  )

// ---------------------------------------------------------------------------------------------------------------
// Invoices

export function validateInvoice(f: InvoiceFields, ref: ReferenceData): ValidationResult {
  const out = new Collector()
  const links: Links = { propertyId: null, contractorId: null, maintenanceRequestId: null, leaseId: null }

  for (const key of ['supplierName', 'invoiceNumber', 'invoiceDate', 'total'] as const) {
    if (f[key] === null) out.add('missing_field', 'error', [key], `No ${FIELD_LABELS[key]} was found on the invoice.`)
  }
  for (const key of ['dueDate', 'propertyAddress', 'gst'] as const) {
    if (f[key] === null) out.add('missing_field', 'warning', [key], `No ${FIELD_LABELS[key]} was found on the invoice.`)
  }

  // Arithmetic, in cents.
  const total = f.total !== null ? toCents(f.total) : null
  const gst = f.gst !== null ? toCents(f.gst) : null
  const subtotal = f.subtotal !== null ? toCents(f.subtotal) : null
  if (total !== null && gst !== null) {
    const expected = Math.round((total * 3) / 23)
    if (Math.abs(gst - expected) > TOLERANCE_CENTS) {
      out.add(
        'gst_not_3_23',
        'error',
        ['gst', 'total'],
        `GST is ${formatMoney(gst / 100)}, but a ${formatMoney(total / 100)} total includes ${formatMoney(expected / 100)} of GST at 15% (3/23 of the total). Check the GST rate and the total on the invoice.`,
      )
    }
  }
  if (subtotal !== null && gst !== null && total !== null && Math.abs(subtotal + gst - total) > TOLERANCE_CENTS) {
    out.add(
      'totals_dont_add',
      'error',
      ['subtotal', 'gst', 'total'],
      `Subtotal ${formatMoney(subtotal / 100)} plus GST ${formatMoney(gst / 100)} is ${formatMoney((subtotal + gst) / 100)}, not the ${formatMoney(total / 100)} total.`,
    )
  }
  const base = subtotal ?? (total !== null && gst !== null ? total - gst : null)
  if (f.lineItems && f.lineItems.length > 0 && base !== null) {
    const sum = f.lineItems.reduce((s, l) => s + toCents(l.amount), 0)
    if (Math.abs(sum - base) > TOLERANCE_CENTS) {
      out.add(
        'line_items_dont_add',
        'error',
        ['lineItems', 'subtotal'],
        `The line items add up to ${formatMoney(sum / 100)}, but the subtotal is ${formatMoney(base / 100)}.`,
      )
    }
  }

  if (f.invoiceDate && f.dueDate && f.dueDate < f.invoiceDate) {
    out.add(
      'due_before_invoice',
      'error',
      ['dueDate', 'invoiceDate'],
      `The due date (${formatDate(f.dueDate)}) is before the invoice date (${formatDate(f.invoiceDate)}). One of them is probably a typo.`,
    )
  }

  // Supplier, by name or GST number.
  const { byName, byGst } = matchContractor(f.supplierName, f.supplierGstNumber, ref.contractors)
  const contractor = byGst ?? byName
  if (f.supplierName && !contractor) {
    out.add(
      'supplier_unknown',
      'warning',
      ['supplierName'],
      `"${f.supplierName}" isn't a contractor on file, by name or GST number. Add the supplier before paying them.`,
    )
  }
  if (byGst && byName && byGst.id !== byName.id) {
    out.add(
      'supplier_mismatch',
      'warning',
      ['supplierName', 'supplierGstNumber'],
      `The name matches ${byName.name} but the GST number belongs to ${byGst.name}.`,
    )
  }
  if (contractor) links.contractorId = contractor.id

  if (f.supplierGstNumber) {
    if (!isValidIrdNumber(f.supplierGstNumber)) {
      out.add(
        'gst_number_invalid',
        'error',
        ['supplierGstNumber'],
        `GST number ${f.supplierGstNumber} fails the IRD check digit, so it isn't a valid GST number${contractor?.gstNumber ? ` (${contractor.name} is registered as ${contractor.gstNumber})` : ''}.`,
      )
    } else if (contractor?.gstNumber && digitsOnly(contractor.gstNumber) !== digitsOnly(f.supplierGstNumber)) {
      out.add(
        'gst_number_differs',
        'warning',
        ['supplierGstNumber'],
        `GST number ${f.supplierGstNumber} is not the one on file for ${contractor.name} (${contractor.gstNumber}).`,
      )
    }
  } else {
    out.add(
      'gst_number_missing',
      'warning',
      ['supplierGstNumber'],
      'The invoice shows no GST number. A valid tax invoice shows the supplier\'s GST number; ask for a corrected invoice before claiming the GST.',
    )
  }

  if (f.supplierBankAccount && contractor?.bankAccount && digitsOnly(f.supplierBankAccount) !== digitsOnly(contractor.bankAccount)) {
    out.add(
      'bank_account_differs',
      'warning',
      ['supplierBankAccount'],
      `Bank account ${f.supplierBankAccount} is not the one on file for ${contractor.name} (${contractor.bankAccount}). Confirm a change of account by phone before paying.`,
    )
  }

  // Property.
  const property = matchProperty(f.propertyAddress, ref.properties)?.property ?? null
  if (f.propertyAddress && !property) {
    out.add(
      'property_unknown',
      'error',
      ['propertyAddress'],
      `"${f.propertyAddress}" isn't a property in the portfolio.`,
    )
  }
  if (property) links.propertyId = property.id

  // Maintenance job and quote.
  if (contractor && property && !NO_JOB_TRADES.has(contractor.trade)) {
    const jobs = ref.jobs.filter((j) => j.propertyId === property.id && j.contractorId === contractor.id)
    if (jobs.length === 0) {
      out.add(
        'job_not_found',
        'warning',
        [],
        `No maintenance job for ${contractor.name} at ${property.address} is on file. Check the work was ordered.`,
      )
    } else {
      const job = bestJob(jobs, (f.lineItems ?? []).map((l) => l.description).join(' '))
      links.maintenanceRequestId = job.id
      if (job.quoteAmount && total !== null && total > Math.round(job.quoteAmount * 100 * (1 + QUOTE_ALLOWANCE))) {
        const over = ((total / 100 - job.quoteAmount) / job.quoteAmount) * 100
        out.add(
          'over_quote',
          'error',
          ['total'],
          `The total ${formatMoney(total / 100)} is ${over.toFixed(1)}% above the ${formatMoney(job.quoteAmount)} quote for "${job.title}" (more than the 10% allowed).`,
        )
      }
      if (job.status !== 'completed') {
        out.add(
          'job_not_completed',
          'info',
          [],
          `The job "${job.title}" is still marked ${job.status.replace('_', ' ')}. Check the work is done, then update the job.`,
        )
      }
    }
  }

  // Duplicate invoice number from the same supplier.
  if (f.invoiceNumber) {
    const number = normaliseInvoiceNumber(f.invoiceNumber)
    const supplierKey = f.supplierName ? normaliseCompany(f.supplierName) : null
    const duplicate = ref.invoices.find(
      (i) =>
        normaliseInvoiceNumber(i.invoiceNumber) === number &&
        (contractor && i.contractorId !== null
          ? i.contractorId === contractor.id
          : supplierKey !== null && i.supplierName !== null && normaliseCompany(i.supplierName) === supplierKey),
    )
    if (duplicate) {
      out.add(
        'duplicate_invoice',
        'error',
        ['invoiceNumber'],
        `${contractor?.name ?? f.supplierName} invoice ${f.invoiceNumber} is already in the system${duplicate.documentId ? ` (document ${duplicate.documentId})` : ''}. It may be a copy or a reminder; don't pay it twice.`,
      )
    }
  }

  return { issues: out.issues, links }
}

// ---------------------------------------------------------------------------------------------------------------
// Tenancy summaries

export function validateLease(f: LeaseFields, ref: ReferenceData): ValidationResult {
  const out = new Collector()
  const links: Links = { propertyId: null, contractorId: null, maintenanceRequestId: null, leaseId: null }

  for (const key of ['tenantNames', 'propertyAddress', 'startDate', 'weeklyRent', 'bond'] as const) {
    if (f[key] === null) out.add('missing_field', 'error', [key], `No ${FIELD_LABELS[key]} was found on the summary.`)
  }
  for (const key of ['endDate', 'rentFrequency', 'petsAllowed', 'maxOccupants'] as const) {
    if (f[key] === null) out.add('missing_field', 'warning', [key], `No ${FIELD_LABELS[key]} was found on the summary.`)
  }

  if (f.startDate && f.endDate && f.endDate !== 'periodic' && f.endDate < f.startDate) {
    out.add(
      'end_before_start',
      'error',
      ['endDate', 'startDate'],
      `The end date (${formatDate(f.endDate)}) is before the start date (${formatDate(f.startDate)}).`,
    )
  }
  if (f.weeklyRent !== null && f.bond !== null && toCents(f.bond) > toCents(f.weeklyRent) * 4) {
    out.add(
      'bond_over_four_weeks',
      'error',
      ['bond', 'weeklyRent'],
      `Bond ${formatMoney(f.bond)} is more than four weeks' rent (${formatMoney(f.weeklyRent * 4)}), the most a landlord can ask for.`,
    )
  }

  const property = matchProperty(f.propertyAddress, ref.properties)?.property ?? null
  if (f.propertyAddress && !property) {
    out.add('property_unknown', 'error', ['propertyAddress'], `"${f.propertyAddress}" isn't a property in the portfolio.`)
  }
  if (property) {
    links.propertyId = property.id
    const leases = ref.leases.filter((l) => l.propertyId === property.id)
    const names = f.tenantNames ?? []
    const lease =
      leases.find((l) => tenantMatches(names, l)) ??
      leases.find((l) => l.status === 'active') ??
      [...leases].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
    if (!lease) {
      out.add('lease_not_found', 'warning', ['propertyAddress'], `No lease for ${property.address} is on file.`)
    } else {
      links.leaseId = lease.id
      if (names.length > 0 && !tenantMatches(names, lease)) {
        out.add(
          'tenant_differs',
          'warning',
          ['tenantNames'],
          `The tenants named (${names.join(', ')}) don't match the lease on file (${lease.tenantNames.join(', ')}).`,
        )
      }
      if (f.weeklyRent !== null && toCents(f.weeklyRent) !== toCents(lease.weeklyRent)) {
        out.add(
          'rent_differs',
          'error',
          ['weeklyRent'],
          `Weekly rent on the summary is ${formatMoney(f.weeklyRent)}; the lease record says ${formatMoney(lease.weeklyRent)}.`,
        )
      }
      if (f.bond !== null && toCents(f.bond) !== toCents(lease.bondAmount)) {
        out.add(
          'bond_differs',
          'error',
          ['bond'],
          `Bond on the summary is ${formatMoney(f.bond)}; the lease record says ${formatMoney(lease.bondAmount)}.`,
        )
      }
      if (lease.status === 'ended') {
        out.add('lease_ended', 'info', [], `This lease ended${lease.endDate ? ` on ${formatDate(lease.endDate)}` : ''}.`)
      }
    }
  }

  return { issues: out.issues, links }
}

export function validate(kind: DocumentKind, fields: Fields, ref: ReferenceData): ValidationResult {
  return kind === 'invoice' ? validateInvoice(fields as InvoiceFields, ref) : validateLease(fields as LeaseFields, ref)
}
