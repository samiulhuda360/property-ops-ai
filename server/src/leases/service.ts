// Lease abstraction end to end: store the PDF, read its pages, run a route, check, find risks, schedule charges,
// reconcile them against the issued invoices, save the LeaseAbstract row and the audit event; then a person's
// per-field approvals and corrections, risk decisions, final approval or rejection, and the JSON / CSV export.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import type { Prisma } from '@prisma/client'
import { AiError, aiEnabled } from '../ai/llm'
import { matchProperty } from '../documents/address'
import { audit } from '../lib/audit'
import { recordReview, recordRun } from '../lib/automation'
import { prisma } from '../lib/prisma'
import { scheduleCharges } from './charges'
import { sameTermValue } from './compare'
import { abstractLease, rulesRoute, type Abstraction } from './pipeline'
import { reconcileCharges, type IssuedInvoiceRef } from './reconcile'
import { findRisks } from './risks'
import { pdfPages } from './text'
import {
  FIELD_LABELS,
  isAlarm,
  TERM_FIELDS,
  type Charge,
  type ExtractedTerm,
  type ExtractedTerms,
  type Issue,
  type LeaseTerms,
  type PageText,
  type Reconciliation,
  type RiskFinding,
  type RiskStatus,
  type Route,
  type TermField,
} from './types'
import { checkValues, validateTerms } from './validate'
import type { Actor } from '../lib/actor'

export class LeaseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function storageDir(): string {
  return process.env.LEASE_STORAGE_DIR || resolve(__dirname, '../../storage/leases')
}

/** The route new uploads use: hybrid when a model is configured (or replies are being replayed), otherwise rules. */
export const defaultRoute = (): Route => (aiEnabled() ? 'hybrid' : 'rules')

export const AUTOMATION = 'lease_abstraction' as const
export const itemRef = (id: number) => `lease:${id}`
const json = (value: unknown) => value as Prisma.InputJsonValue

function saveFile(data: Uint8Array, originalName: string): string {
  const dir = storageDir()
  mkdirSync(dir, { recursive: true })
  const safe = basename(originalName).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').slice(-80) || 'lease.pdf'
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}-${/\.pdf$/i.test(safe) ? safe : `${safe}.pdf`}`
  writeFileSync(join(dir, name), data)
  return name
}

export function storedFilePath(storagePath: string | null): string | null {
  if (!storagePath) return null
  const dir = resolve(storageDir())
  const full = resolve(dir, storagePath)
  if (!full.startsWith(dir + sep)) return null
  return existsSync(full) ? full : null
}

export function removeStoredFile(storagePath: string | null) {
  const full = storedFilePath(storagePath)
  if (full) unlinkSync(full)
}

// ---------------------------------------------------------------------------------------------------------------
// Issued invoices and reconciliation

export async function invoicesFor(actor: Actor, leaseRef: string | null): Promise<IssuedInvoiceRef[]> {
  if (!leaseRef) return []
  const rows = await prisma.issuedInvoice.findMany({ where: { organisationId: actor.organisationId, leaseRef: { equals: leaseRef, mode: 'insensitive' } } })
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    sourceRow: r.sourceRow,
    leaseRef: r.leaseRef,
    description: r.description,
    kind: r.kind,
    amount: r.amount,
    currency: r.currency,
    dueDate: r.dueDate.toISOString().slice(0, 10),
  }))
}

/** Parses one CSV line (RFC 4180 quoting). */
export function csvCells(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else cur += ch
  }
  cells.push(cur)
  return cells
}

/**
 * Imports the billing system's issued invoices from a CSV with the columns
 * row, invoice_number, lease_ref, description, kind, amount, currency, due_date, period.
 * An invoice number already imported is replaced.
 */
export async function importIssuedInvoices(actor: Actor, csv: string): Promise<number> {
  const lines = csv.replace(/\r/g, '').split('\n').filter((l) => l.trim())
  const header = csvCells(lines[0]).map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  for (const name of ['invoice_number', 'lease_ref', 'kind', 'amount', 'currency', 'due_date']) {
    if (col(name) < 0) throw new LeaseError(400, `The CSV has no ${name} column.`)
  }
  let count = 0
  for (const [i, line] of lines.slice(1).entries()) {
    const c = csvCells(line)
    const invoiceNumber = c[col('invoice_number')]?.trim()
    const dueDate = c[col('due_date')]?.trim()
    const amount = Number(c[col('amount')])
    if (!invoiceNumber || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(amount)) continue
    const data = {
      userId: actor.userId,
      organisationId: actor.organisationId,
      invoiceNumber,
      sourceRow: col('row') >= 0 && Number(c[col('row')]) ? Number(c[col('row')]) : i + 2,
      leaseRef: c[col('lease_ref')].trim(),
      description: col('description') >= 0 ? c[col('description')].trim() : '',
      kind: c[col('kind')].trim().toLowerCase(),
      amount,
      currency: c[col('currency')].trim().toUpperCase(),
      dueDate: new Date(`${dueDate}T00:00:00Z`),
      period: col('period') >= 0 ? c[col('period')].trim() : null,
    }
    await prisma.issuedInvoice.upsert({ where: { organisationId_invoiceNumber: { organisationId: actor.organisationId, invoiceNumber } }, create: data, update: data })
    count++
  }
  return count
}

// ---------------------------------------------------------------------------------------------------------------
// Processing

export interface ProcessInput {
  actor: Actor
  fileName: string
  data: Uint8Array
  route?: Route
  /** When the lease arrived (the demo loader backdates its sample). */
  receivedAt?: Date
}

function emptyAbstraction(pages: PageText[], issue: Issue): Abstraction {
  const extracted = {} as ExtractedTerms
  const terms = {} as Record<string, unknown>
  for (const f of TERM_FIELDS) {
    extracted[f] = { value: null, page: null, quote: null, confidence: 'low', source: 'rules', status: 'needs_person' }
    terms[f] = null
  }
  return {
    country: 'NZ',
    leaseType: 'commercial',
    route: 'rules',
    terms: terms as unknown as LeaseTerms,
    extracted,
    issues: [issue],
    risks: [],
    charges: [],
    model: { calls: 0, live: 0, cached: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, repaired: false },
  }
}

const RELATIONS = { property: { select: { id: true, code: true, address: true, suburb: true } } } as const

/** Reads, abstracts, checks and stores one lease PDF; records the automation run and the audit event. */
export async function processLease(input: ProcessInput) {
  let pages: PageText[]
  try {
    pages = await pdfPages(input.data)
  } catch (e) {
    throw new LeaseError(400, e instanceof Error ? e.message : 'Could not read the PDF.')
  }
  const route = input.route ?? defaultRoute()
  let abstraction: Abstraction
  let outcome: 'auto' | 'failed' = 'auto'
  if (!pages.some((p) => p.text.trim())) {
    outcome = 'failed'
    abstraction = emptyAbstraction(pages, {
      code: 'no_text',
      field: '',
      fields: [],
      severity: 'error',
      message: 'This PDF has no text layer (it may be a scan), so nothing could be read. Enter the terms by hand or reject it.',
    })
  } else {
    try {
      abstraction = await abstractLease(pages, route)
    } catch (e) {
      if (!(e instanceof AiError)) throw e
      abstraction = await rulesRoute.run({ pages })
      abstraction.issues.push({
        code: 'model_unavailable',
        field: '',
        fields: [],
        severity: 'info',
        message: 'The model could not be reached, so the rules read this lease.',
      })
    }
  }

  const properties = await prisma.property.findMany({ where: { organisationId: input.actor.organisationId }, select: { id: true, code: true, address: true, suburb: true } })
  const property = matchProperty(abstraction.terms.premises, properties)
  const reconciliation = reconcileCharges(abstraction.terms.leaseRef, abstraction.charges, await invoicesFor(input.actor, abstraction.terms.leaseRef))
  const storagePath = saveFile(input.data, input.fileName)
  const lease = await prisma.leaseAbstract.create({
    data: {
      userId: input.actor.userId,
      organisationId: input.actor.organisationId,
      fileName: basename(input.fileName),
      storagePath,
      pages: json(pages),
      country: abstraction.country,
      leaseType: abstraction.leaseType,
      route: abstraction.route,
      leaseRef: abstraction.terms.leaseRef,
      terms: json(abstraction.extracted),
      issues: json(abstraction.issues),
      risks: json(abstraction.risks),
      charges: json(abstraction.charges),
      reconciliation: json(reconciliation),
      propertyId: property?.property.id ?? null,
      status: 'needs_review',
      ...(input.receivedAt ? { createdAt: input.receivedAt } : {}),
    },
    include: RELATIONS,
  })
  const needsPerson = TERM_FIELDS.filter((f) => abstraction.extracted[f].status === 'needs_person')
  await audit({
    actor: input.actor,
    leaseAbstractId: lease.id,
    action: 'lease.extracted',
    after: {
      route: abstraction.route,
      country: abstraction.country,
      leaseType: abstraction.leaseType,
      needsPerson,
      alarms: abstraction.issues.filter(isAlarm).map((i) => i.code),
      risks: abstraction.risks.map((r) => r.code),
      modelCalls: abstraction.model.calls,
      liveCalls: abstraction.model.live,
    },
    note: `${abstraction.route} read ${TERM_FIELDS.length - needsPerson.length} of ${TERM_FIELDS.length} terms; ${needsPerson.length} need a person.`,
    at: input.receivedAt,
  })
  await recordRun({ actor: input.actor, automation: AUTOMATION, itemRef: itemRef(lease.id), outcome, at: input.receivedAt })
  return lease
}

// ---------------------------------------------------------------------------------------------------------------
// Review

type Stored = Record<TermField, ExtractedTerm>
const storedTerms = (terms: unknown) => terms as Stored
const valuesOf = (terms: Stored): LeaseTerms => Object.fromEntries(TERM_FIELDS.map((f) => [f, terms[f]?.value ?? null])) as unknown as LeaseTerms

async function findOwn(actor: Actor, id: number) {
  const lease = Number.isInteger(id) ? await prisma.leaseAbstract.findFirst({ where: { id, organisationId: actor.organisationId } }) : null
  if (!lease) throw new LeaseError(404, 'Lease not found')
  return lease
}

function assertField(field: string): asserts field is TermField {
  if (!(TERM_FIELDS as readonly string[]).includes(field)) throw new LeaseError(400, `Unknown field "${field}".`)
}

/** Re-runs the checks, the charge schedule, the risks and the reconciliation after a person changed a term. */
async function recompute(actor: Actor, lease: { id: number; country: string | null; leaseType: string | null; pages: unknown }, terms: Stored) {
  const values = valuesOf(terms)
  const country = (lease.country ?? 'NZ') as Abstraction['country']
  const leaseType = (lease.leaseType ?? 'commercial') as Abstraction['leaseType']
  const issues = validateTerms(values, country, leaseType)
  const doubted = new Set(issues.filter(isAlarm).flatMap((i) => i.fields))
  for (const f of TERM_FIELDS) {
    // A term a check now doubts goes to a person; one that went to a person only because of a check that now passes
    // comes back as read (medium confidence). Approved and corrected terms are left alone.
    if (terms[f].status === 'extracted' && doubted.has(f)) terms[f] = { ...terms[f], confidence: 'low', status: 'needs_person' }
    else if (terms[f].status === 'needs_person' && !doubted.has(f) && terms[f].value !== null) terms[f] = { ...terms[f], confidence: 'medium', status: 'extracted' }
  }
  const pages = lease.pages as PageText[]
  const risks = findRisks(values, terms, pages, leaseType)
  const charges = scheduleCharges(values)
  const reconciliation = reconcileCharges(values.leaseRef, charges, await invoicesFor(actor, values.leaseRef))
  return { issues, risks, charges, reconciliation, leaseRef: values.leaseRef }
}

const seconds = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 4 * 3600) : 0
}

/**
 * A person approves one term as read, or corrects it. A correction is checked against the field schema, re-runs the
 * checks, risks, charges and reconciliation, and is written to the audit log with the value before and after.
 */
export async function reviewField(actor: Actor, id: number, field: string, body: { value?: unknown; approve?: boolean }) {
  const lease = await findOwn(actor, id)
  if (lease.status !== 'needs_review') throw new LeaseError(409, `This lease is already ${lease.status}.`)
  assertField(field)
  const terms = storedTerms(lease.terms)
  const before = terms[field]
  let after: ExtractedTerm
  let action: string
  if (body.approve || !('value' in body)) {
    after = { ...before, status: 'approved', confidence: 'high' }
    action = 'lease.field_approved'
  } else {
    const checked = checkValues({ [field]: body.value === '' ? null : body.value })
    const problem = checked.issues.find((i) => i.field === field)
    if (problem) throw new LeaseError(400, problem.message)
    const value = (checked.values as unknown as Record<string, unknown>)[field] ?? null
    if (sameTermValue(field, before.value, value)) {
      after = { ...before, status: 'approved', confidence: 'high' }
      action = 'lease.field_approved'
    } else {
      after = { value, page: before.page, quote: before.quote, confidence: 'high', source: 'person', status: 'corrected' }
      action = 'lease.field_corrected'
    }
  }
  terms[field] = after
  // Re-runs the checks; the person's decision on this field stands, other terms a check now doubts go back to a person.
  const { issues, risks, charges, reconciliation, leaseRef } = await recompute(actor, lease, terms)
  const existingRisks = (lease.risks as unknown as RiskFinding[]) ?? []
  const keptRisks = risks.map((r) => ({ ...r, status: existingRisks.find((x) => x.code === r.code)?.status ?? 'open' }))
  const updated = await prisma.leaseAbstract.update({
    where: { id },
    data: { terms: json(terms), issues: json(issues), risks: json(keptRisks), charges: json(charges), reconciliation: json(reconciliation), leaseRef },
    include: RELATIONS,
  })
  await audit({
    actor,
    leaseAbstractId: id,
    action,
    field,
    before: before.value,
    after: after.value,
    note: action === 'lease.field_corrected' ? `${FIELD_LABELS[field]} corrected from ${JSON.stringify(before.value)} to ${JSON.stringify(after.value)}.` : `${FIELD_LABELS[field]} approved as read.`,
  })
  return updated
}

/** A person accepts or dismisses a risk finding. */
export async function reviewRisk(actor: Actor, id: number, code: string, body: { status?: unknown; note?: unknown }) {
  const lease = await findOwn(actor, id)
  const status = body.status
  if (status !== 'accepted' && status !== 'dismissed' && status !== 'open') throw new LeaseError(400, 'status must be accepted, dismissed or open.')
  const risks = (lease.risks as unknown as RiskFinding[]) ?? []
  const risk = risks.find((r) => r.code === code)
  if (!risk) throw new LeaseError(404, 'Risk finding not found')
  const before = risk.status
  risk.status = status as RiskStatus
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
  const updated = await prisma.leaseAbstract.update({ where: { id }, data: { risks: json(risks) }, include: RELATIONS })
  await audit({ actor, leaseAbstractId: id, action: 'lease.risk_reviewed', field: code, before, after: status, note: note || `${risk.title}: ${status}.` })
  return updated
}

/**
 * Final approval: every term that needed a person must have been approved or corrected. Records the review time on
 * the automation run; nothing is posted anywhere.
 */
export async function approveLease(actor: Actor, id: number, body: { reviewSeconds?: unknown }) {
  const lease = await findOwn(actor, id)
  if (lease.status !== 'needs_review') throw new LeaseError(409, `This lease is already ${lease.status}.`)
  const terms = storedTerms(lease.terms)
  const pending = TERM_FIELDS.filter((f) => terms[f]?.status === 'needs_person')
  if (pending.length) {
    throw new LeaseError(400, `Approve or correct ${pending.map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')} before approving the lease.`)
  }
  const corrected = TERM_FIELDS.filter((f) => terms[f]?.status === 'corrected')
  const reviewSeconds = seconds(body.reviewSeconds)
  const updated = await prisma.leaseAbstract.update({
    where: { id },
    data: { status: 'approved', reviewedAt: new Date(), reviewSeconds: (lease.reviewSeconds ?? 0) + reviewSeconds },
    include: RELATIONS,
  })
  await recordReview(itemRef(id), reviewSeconds, corrected.length ? 'corrected' : 'reviewed')
  await audit({ actor, leaseAbstractId: id, action: 'lease.approved', after: { corrected }, note: corrected.length ? `Approved with ${corrected.length} corrected term${corrected.length > 1 ? 's' : ''}.` : 'Approved as read.' })
  return updated
}

export async function rejectLease(actor: Actor, id: number, body: { reviewSeconds?: unknown; reason?: unknown }) {
  const lease = await findOwn(actor, id)
  if (lease.status === 'rejected') throw new LeaseError(409, 'This lease is already rejected.')
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  const reviewSeconds = seconds(body.reviewSeconds)
  const updated = await prisma.leaseAbstract.update({
    where: { id },
    data: { status: 'rejected', reviewedAt: new Date(), reviewSeconds: (lease.reviewSeconds ?? 0) + reviewSeconds },
    include: RELATIONS,
  })
  await recordReview(itemRef(id), reviewSeconds, 'rejected')
  await audit({ actor, leaseAbstractId: id, action: 'lease.rejected', note: reason ? `Rejected: ${reason}` : 'Rejected by a person.' })
  return updated
}

// ---------------------------------------------------------------------------------------------------------------
// Export

export interface ExportedLease {
  id: number
  fileName: string
  country: string | null
  leaseType: string | null
  route: string
  status: string
  terms: Record<string, { value: unknown; page: number | null; quote: string | null; confidence: string; status: string }>
  issues: Issue[]
  risks: RiskFinding[]
  charges: Charge[]
  reconciliation: Reconciliation | null
}

export async function exportLease(actor: Actor, id: number): Promise<ExportedLease> {
  const lease = await findOwn(actor, id)
  const terms = storedTerms(lease.terms)
  return {
    id: lease.id,
    fileName: lease.fileName,
    country: lease.country,
    leaseType: lease.leaseType,
    route: lease.route,
    status: lease.status,
    terms: Object.fromEntries(TERM_FIELDS.map((f) => [f, { value: terms[f].value, page: terms[f].page, quote: terms[f].quote, confidence: terms[f].confidence, status: terms[f].status }])),
    issues: lease.issues as unknown as Issue[],
    risks: lease.risks as unknown as RiskFinding[],
    charges: lease.charges as unknown as Charge[],
    reconciliation: (lease.reconciliation as unknown as Reconciliation) ?? null,
  }
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The terms, risks and charge schedule of one lease as three CSV sections. */
export function leaseCsv(x: ExportedLease): string {
  const lines: string[] = []
  lines.push('section,field,value,page,confidence,status,quote')
  for (const f of TERM_FIELDS) {
    const t = x.terms[f]
    lines.push(['term', FIELD_LABELS[f], t.value, t.page, t.confidence, t.status, t.quote].map(cell).join(','))
  }
  for (const r of x.risks) lines.push(['risk', r.title, r.severity, r.page, '', r.status, r.quote].map(cell).join(','))
  lines.push('', 'section,kind,description,amount,currency,due_date,period,reconciliation')
  for (const c of x.charges) {
    const line = x.reconciliation?.lines.find((l) => l.expected === c || (l.expected && l.expected.kind === c.kind && l.expected.dueDate === c.dueDate && l.expected.amount === c.amount))
    lines.push(['charge', c.kind, c.description, c.amount.toFixed(2), c.currency, c.dueDate, c.period, line ? `${line.status}${line.invoice ? ` (${line.invoice.invoiceNumber}, row ${line.invoice.row})` : ''}` : ''].map(cell).join(','))
  }
  for (const l of x.reconciliation?.lines.filter((l) => l.status === 'unexpected') ?? []) {
    lines.push(['invoice', l.invoice!.description, l.invoice!.invoiceNumber, l.invoice!.amount.toFixed(2), l.invoice!.currency, l.invoice!.dueDate, `row ${l.invoice!.row}`, 'unexpected'].map(cell).join(','))
  }
  return lines.join('\n') + '\n'
}
