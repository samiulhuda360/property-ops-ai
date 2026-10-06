// Documents end to end: store the PDF, read its text, extract and check the fields, save the Document row and record
// the automation run; then a person's approval (with corrections) or rejection, and the export to accounting.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import type { Prisma } from '@prisma/client'
import { AiError, aiEnabled } from '../ai/llm'
import { recordReview, recordRun } from '../lib/automation'
import { prisma } from '../lib/prisma'
import { sameFieldValue } from './compare'
import { extractDocument, rulesMethod, type Extraction } from './pipeline'
import { loadReferenceData } from './reference'
import { detectKind } from './rules'
import { valueSchemas } from './schema'
import { pdfText } from './text'
import {
  fieldNames,
  NO_LINKS,
  type DocumentKind,
  type ExtractedField,
  type Fields,
  type InvoiceFields,
  type Issue,
  type Method,
} from './types'
import { FIELD_LABELS, validate } from './validate'

export class DocumentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function storageDir(): string {
  return process.env.DOCUMENT_STORAGE_DIR || resolve(__dirname, '../../storage/documents')
}

/** The method new documents use: the model with validation when a model is configured, otherwise the rules. */
export const defaultMethod = (): Method => (aiEnabled() ? 'llm+validation' : 'rules')

export const automationFor = (kind: DocumentKind) => (kind === 'invoice' ? 'invoice_extraction' : 'lease_extraction')
export const itemRef = (id: number) => `document:${id}`

function saveFile(data: Uint8Array, originalName: string): string {
  const dir = storageDir()
  mkdirSync(dir, { recursive: true })
  const safe = basename(originalName).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').slice(-80) || 'document.pdf'
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}-${/\.pdf$/i.test(safe) ? safe : `${safe}.pdf`}`
  writeFileSync(join(dir, name), data)
  return name
}

/** The stored PDF's absolute path, or null when it is missing or the path would leave the storage folder. */
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

const toDate = (iso: unknown) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00.000Z`) : null)

/** The typed columns kept alongside the JSON, for listing, sorting and the bank reconciliation. */
function typedColumns(kind: DocumentKind, values: Fields) {
  if (kind !== 'invoice') return { invoiceNumber: null, invoiceDate: null, dueDate: null, total: null, gst: null }
  const v = values as InvoiceFields
  return {
    invoiceNumber: v.invoiceNumber,
    invoiceDate: toDate(v.invoiceDate),
    dueDate: toDate(v.dueDate),
    total: v.total,
    gst: v.gst,
  }
}

const json = (value: unknown) => value as Prisma.InputJsonValue

function emptyExtraction(kind: DocumentKind, issue: Issue): Extraction {
  const extracted: Record<string, ExtractedField> = {}
  const values: Record<string, unknown> = {}
  for (const name of fieldNames(kind)) {
    extracted[name] = { value: null, confidence: 'low', source: 'rules' }
    values[name] = null
  }
  return {
    kind,
    method: 'rules',
    values: values as unknown as Fields,
    extracted,
    issues: [issue],
    links: { ...NO_LINKS },
    model: { calls: 0, live: 0, cached: 0, latencyMs: 0, repaired: false },
  }
}

export interface ProcessInput {
  userId: number
  fileName: string
  data: Uint8Array
  /** Defaults to llm+validation when a model is configured, otherwise rules. */
  method?: Method
  /** When the document arrived (the demo loader backdates its sample). */
  receivedAt?: Date
}

/** Reads, extracts, checks and stores one PDF, and records the automation run. Throws DocumentError for bad files. */
export async function processDocument(input: ProcessInput) {
  let text: string
  try {
    text = await pdfText(input.data)
  } catch (e) {
    throw new DocumentError(400, e instanceof Error ? e.message : 'Could not read the PDF.')
  }

  const ref = await loadReferenceData(input.userId)
  const method = input.method ?? defaultMethod()
  let extraction: Extraction
  let outcome: 'auto' | 'failed' = 'auto'
  if (!text.trim()) {
    outcome = 'failed'
    extraction = emptyExtraction('invoice', {
      code: 'no_text',
      field: '',
      fields: [],
      severity: 'error',
      message: 'This PDF has no text layer (it may be a scan or a photo), so nothing could be read. Enter the fields by hand or reject it.',
    })
  } else {
    const kind = detectKind(text)
    try {
      extraction = await extractDocument(text, method, ref, kind)
    } catch (e) {
      if (!(e instanceof AiError)) throw e
      // The model is unreachable (quota, network): fall back to the rules so the document still gets checked.
      extraction = await rulesMethod.run({ text, kind, ref })
      extraction.issues.push({
        code: 'model_unavailable',
        field: '',
        fields: [],
        severity: 'info',
        message: 'The model could not be reached, so the rules read this document.',
      })
    }
  }

  const storagePath = saveFile(input.data, input.fileName)
  const doc = await prisma.document.create({
    data: {
      userId: input.userId,
      kind: extraction.kind,
      fileName: basename(input.fileName),
      storagePath,
      text,
      method: extraction.method,
      extracted: json(extraction.extracted),
      issues: json(extraction.issues),
      status: 'needs_review',
      ...extraction.links,
      ...typedColumns(extraction.kind, extraction.values),
      ...(input.receivedAt ? { createdAt: input.receivedAt } : {}),
    },
  })
  await recordRun({
    userId: input.userId,
    automation: automationFor(extraction.kind),
    itemRef: itemRef(doc.id),
    outcome,
    at: input.receivedAt,
  })
  return doc
}

// ---------------------------------------------------------------------------------------------------------------
// Review

export function valuesOf(kind: DocumentKind, extracted: unknown): Record<string, unknown> {
  const stored = (extracted ?? {}) as Record<string, Partial<ExtractedField>>
  const values: Record<string, unknown> = {}
  for (const name of fieldNames(kind)) values[name] = stored[name]?.value ?? null
  return values
}

/** Checks a person's corrections against the field schemas; unknown fields are ignored. */
function parseCorrections(kind: DocumentKind, fields: unknown): Record<string, unknown> {
  if (fields === undefined || fields === null) return {}
  if (typeof fields !== 'object' || Array.isArray(fields)) throw new DocumentError(400, 'fields must be an object')
  const schemas = valueSchemas(kind)
  const out: Record<string, unknown> = {}
  for (const name of fieldNames(kind)) {
    if (!(name in fields)) continue
    let raw = (fields as Record<string, unknown>)[name]
    if (raw === '') raw = null
    const parsed = schemas[name].safeParse(raw)
    if (!parsed.success) {
      throw new DocumentError(400, `The ${FIELD_LABELS[name]} ${parsed.error.issues[0]?.message ?? 'is not valid'}.`)
    }
    out[name] = parsed.data ?? null
  }
  return out
}

const seconds = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 4 * 3600) : 0
}

const REQUIRED_TO_APPROVE: Record<DocumentKind, string[]> = {
  invoice: ['supplierName', 'invoiceNumber', 'invoiceDate', 'dueDate', 'total'],
  lease: ['tenantNames', 'propertyAddress', 'startDate', 'weeklyRent', 'bond'],
}

async function findOwn(userId: number, id: number) {
  const doc = Number.isInteger(id) ? await prisma.document.findFirst({ where: { id, userId } }) : null
  if (!doc) throw new DocumentError(404, 'Document not found')
  return doc
}

/**
 * Approves a document with the person's corrections. Records the review as "corrected" when any field changed,
 * otherwise "reviewed". Approval only records the decision: nothing is paid, sent or posted.
 */
export async function approveDocument(userId: number, id: number, body: { fields?: unknown; reviewSeconds?: unknown }) {
  const doc = await findOwn(userId, id)
  if (doc.status !== 'needs_review') throw new DocumentError(409, `This document is already ${doc.status}.`)
  const kind = doc.kind as DocumentKind
  const before = valuesOf(kind, doc.extracted)
  const corrections = parseCorrections(kind, body.fields)
  const after = { ...before, ...corrections }
  const missing = REQUIRED_TO_APPROVE[kind].filter((f) => after[f] === null || after[f] === undefined)
  if (missing.length) {
    throw new DocumentError(400, `Fill in the ${missing.map((f) => FIELD_LABELS[f]).join(', ')} before approving.`)
  }
  const changed = fieldNames(kind).filter((f) => f in corrections && !sameFieldValue(f, before[f], after[f]))

  const ref = await loadReferenceData(userId, { excludeDocumentId: id })
  const { issues, links } = validate(kind, after as unknown as Fields, ref)
  const extracted = { ...(doc.extracted as unknown as Record<string, ExtractedField>) }
  for (const f of changed) extracted[f] = { value: after[f], confidence: 'high', source: 'person' }

  const reviewSeconds = seconds(body.reviewSeconds)
  const updated = await prisma.document.update({
    where: { id },
    data: {
      extracted: json(extracted),
      issues: json(issues),
      ...links,
      ...typedColumns(kind, after as unknown as Fields),
      status: 'approved',
      reviewedAt: new Date(),
      reviewSeconds: (doc.reviewSeconds ?? 0) + reviewSeconds,
    },
  })
  await recordReview(itemRef(id), reviewSeconds, changed.length ? 'corrected' : 'reviewed')
  return { document: updated, changedFields: changed }
}

export async function rejectDocument(userId: number, id: number, body: { reviewSeconds?: unknown; reason?: unknown }) {
  const doc = await findOwn(userId, id)
  if (doc.status !== 'needs_review' && doc.status !== 'approved') {
    throw new DocumentError(409, `This document is already ${doc.status}.`)
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  const issues = [
    ...((doc.issues as unknown as Issue[]) ?? []),
    {
      code: 'rejected',
      field: '',
      fields: [],
      severity: 'info',
      message: reason ? `Rejected: ${reason}` : 'Rejected by a person.',
    } satisfies Issue,
  ]
  const reviewSeconds = seconds(body.reviewSeconds)
  const updated = await prisma.document.update({
    where: { id },
    data: {
      issues: json(issues),
      status: 'rejected',
      reviewedAt: new Date(),
      reviewSeconds: (doc.reviewSeconds ?? 0) + reviewSeconds,
    },
  })
  await recordReview(itemRef(id), reviewSeconds, 'rejected')
  return updated
}

