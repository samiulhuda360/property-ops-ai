// The database side of rent reconciliation: importing a statement, keeping the rent ledger in step with the bank
// lines, recording a person's decisions, and the summaries the page and the Excel report show.
//
// The rent ledger is always rebuilt from the bank lines (replayed in date order per tenancy), so importing a file
// twice, importing statements out of order, or changing a decision can never double-count money.
import { Prisma, type BankTransaction } from '@prisma/client'
import { aiConfig, aiEnabled } from '../ai/llm'
import { recordReview, recordRun, type RunOutcome } from '../lib/automation'
import { prisma } from '../lib/prisma'
import { suggestForLine, type AiSuggestion, type SuggestionInput } from './ai'
import { computeArrears, outstanding, replayLease, type ArrearsRow } from './allocate'
import { batchId, lineHashes, lineKey, parseStatement, type ParseError } from './csv'
import { leaseLabel, pickLease, reconcile } from './engine'
import { round2 } from './text'
import {
  EXCEPTION_CODES,
  EXCEPTION_LABELS,
  METHOD_LABELS,
  type Allocation,
  type Candidate,
  type ExceptionCode,
  type LeaseRef,
  type MatchMethod,
  type Snapshot,
  type StatementLine,
} from './types'

export const AUTOMATION = 'rent_reconciliation' as const

type Db = Prisma.TransactionClient

const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (s: string) => new Date(`${s}T00:00:00.000Z`)
const asJson = (value: unknown) => value as Prisma.InputJsonValue

export class ReconciliationError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message)
  }
}

/** Stored on each bank line (BankTransaction.details). */
export interface LineDetails {
  fileName: string
  row: number
  tranType: string
  method: MatchMethod
  confidence: number
  leaseId: number | null
  propertyId: number | null
  contractorId: number | null
  jobId: number | null
  category: string | null
  /** The money counts towards the tenancy's rent. */
  allocatable: boolean
  allocations: Allocation[]
  credit: number
  shortfall: number
  explanation: string
  suggestedAction: string | null
  candidates: Candidate[]
  duplicateOf: string | null
  /** Every rent payment this line has ever paid towards, so the ledger knows which payments it owns. */
  touchedPayments: number[]
  /** The engine's own decision, kept when a person changes it. */
  engine: { matchStatus: string; matchType: string | null; exception: string | null; leaseId: number | null; jobId: number | null }
}

export interface Resolution {
  decision: 'accept' | 'reassign' | 'ignore'
  leaseId: number | null
  jobId: number | null
  note: string | null
  reviewSeconds: number
  outcome: RunOutcome
  at: string
}

export function readDetails(line: Pick<BankTransaction, 'details'>): LineDetails {
  const d = (line.details ?? {}) as Partial<LineDetails>
  return {
    fileName: d.fileName ?? '',
    row: d.row ?? 0,
    tranType: d.tranType ?? '',
    method: d.method ?? 'none',
    confidence: d.confidence ?? 0,
    leaseId: d.leaseId ?? null,
    propertyId: d.propertyId ?? null,
    contractorId: d.contractorId ?? null,
    jobId: d.jobId ?? null,
    category: d.category ?? null,
    allocatable: d.allocatable ?? false,
    allocations: d.allocations ?? [],
    credit: d.credit ?? 0,
    shortfall: d.shortfall ?? 0,
    explanation: d.explanation ?? '',
    suggestedAction: d.suggestedAction ?? null,
    candidates: d.candidates ?? [],
    duplicateOf: d.duplicateOf ?? null,
    touchedPayments: d.touchedPayments ?? [],
    engine: d.engine ?? { matchStatus: 'unmatched', matchType: null, exception: null, leaseId: null, jobId: null },
  }
}

const isCounted = (line: BankTransaction) => line.matchStatus !== 'ignored' && readDetails(line).allocatable

function toStatementLine(line: BankTransaction): StatementLine {
  const d = readDetails(line)
  return {
    row: d.row,
    date: iso(line.date),
    amount: line.amount,
    payee: line.description,
    particulars: line.particulars ?? '',
    code: line.code ?? '',
    reference: line.reference ?? '',
    tranType: d.tranType,
  }
}

// ---- The portfolio as the engine sees it ----

export interface Portfolio {
  snapshot: Snapshot
  lines: BankTransaction[]
}

/** Leases, rent payments (with the money already allocated to each), contractors, jobs and earlier lines. */
export async function loadPortfolio(userId: number, db: Db = prisma): Promise<Portfolio> {
  const properties = await db.property.findMany({ where: { userId }, orderBy: { id: 'asc' } })
  const leases = await db.lease.findMany({ where: { property: { userId } }, include: { tenant: true, property: true }, orderBy: { id: 'asc' } })
  const payments = await db.payment.findMany({ where: { lease: { property: { userId } } }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }] })
  const contractors = await db.contractor.findMany({ where: { userId }, orderBy: { id: 'asc' } })
  const jobs = await db.maintenanceRequest.findMany({ where: { property: { userId } }, include: { property: true }, orderBy: { id: 'asc' } })
  const lines = await db.bankTransaction.findMany({ where: { userId }, orderBy: [{ date: 'asc' }, { id: 'asc' }] })

  const touched = new Set(lines.flatMap((l) => readDetails(l).touchedPayments))
  const allocated = new Map<number, number>()
  for (const line of lines) {
    if (!isCounted(line)) continue
    for (const a of readDetails(line).allocations) allocated.set(a.paymentId, round2((allocated.get(a.paymentId) ?? 0) + a.amount))
  }

  const snapshot: Snapshot = {
    properties: properties.map((p) => ({ id: p.id, code: p.code, address: p.address, suburb: p.suburb })),
    leases: leases.map((l) => ({
      id: l.id,
      propertyId: l.propertyId,
      propertyCode: l.property.code,
      address: l.property.address,
      suburb: l.property.suburb,
      tenantFirstName: l.tenant.firstName,
      tenantLastName: l.tenant.lastName,
      weeklyRent: l.weeklyRent,
      rentReference: l.rentReference,
      status: l.status,
      startDate: iso(l.startDate),
      endDate: l.endDate ? iso(l.endDate) : null,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      leaseId: p.leaseId,
      dueDate: iso(p.dueDate),
      amount: p.amount,
      covered: p.status === 'paid' && !touched.has(p.id) ? p.amount : Math.min(p.amount, allocated.get(p.id) ?? 0),
    })),
    contractors: contractors.map((c) => ({ id: c.id, name: c.name, trade: c.trade })),
    jobs: jobs.map((j) => ({
      id: j.id,
      contractorId: j.contractorId,
      propertyId: j.propertyId,
      propertyCode: j.property.code,
      address: j.property.address,
      title: j.title,
      quoteAmount: j.quoteAmount,
      cost: j.cost,
      status: j.status,
    })),
    priorLines: lines.map((l) => ({
      key: lineKey(toStatementLine(l)),
      label: `line ${readDetails(l).row} of ${l.importBatch}`,
      date: iso(l.date),
      amount: l.amount,
      leaseId: readDetails(l).leaseId,
      exception: l.exception,
    })),
  }
  return { snapshot, lines }
}

// ---- The rent ledger ----

/**
 * Rebuilds every tenancy's rent ledger from its bank lines in date order, then brings the Payment rows in line:
 * paid (with the date of the line that finished paying it) when fully covered, otherwise pending.
 * Payments paid before any bank line touched them (the opening balance) are left alone.
 */
export async function refreshLedger(userId: number, db: Db): Promise<void> {
  const leases = await db.lease.findMany({ where: { property: { userId } } })
  const payments = await db.payment.findMany({ where: { lease: { property: { userId } } } })
  const lines = await db.bankTransaction.findMany({ where: { userId }, orderBy: [{ date: 'asc' }, { id: 'asc' }] })
  const touched = new Set(lines.flatMap((l) => readDetails(l).touchedPayments))

  for (const lease of leases) {
    const counted = lines.filter((l) => isCounted(l) && readDetails(l).leaseId === lease.id)
    const own = payments.filter((p) => p.leaseId === lease.id)
    const replay = replayLease(
      lease.weeklyRent,
      own.map((p) => ({ id: p.id, leaseId: p.leaseId, dueDate: iso(p.dueDate), amount: p.amount, opening: p.status === 'paid' && !touched.has(p.id) })),
      counted.map((l) => ({ key: l.id, date: iso(l.date), amount: l.amount, order: l.id })),
    )

    for (const line of counted) {
      const result = replay.perLine.get(line.id)!
      const d = readDetails(line)
      const next: LineDetails = {
        ...d,
        allocations: result.allocations,
        credit: result.credit,
        shortfall: result.shortfall,
        touchedPayments: [...new Set([...d.touchedPayments, ...result.allocations.map((a) => a.paymentId)])],
      }
      // Lines nobody has decided yet follow the ledger: under- or overpaid can change when earlier money moves.
      let { exception, matchStatus } = line
      if (!line.resolution && (exception === null || exception === 'underpaid' || exception === 'overpaid')) {
        exception = result.exception
        matchStatus = exception ? 'exception' : 'matched'
      }
      if (JSON.stringify(next) !== JSON.stringify(d) || exception !== line.exception || matchStatus !== line.matchStatus) {
        await db.bankTransaction.update({
          where: { id: line.id },
          data: { details: asJson(next), exception, matchStatus, paymentId: result.allocations[0]?.paymentId ?? null },
        })
      }
    }

    for (const p of replay.payments) {
      if (p.opening) continue
      const row = own.find((x) => x.id === p.id)!
      if (outstanding(p) === 0) {
        if (row.status !== 'paid' || !row.paidDate || iso(row.paidDate) !== p.paidDate) {
          await db.payment.update({ where: { id: p.id }, data: { status: 'paid', paidDate: p.paidDate ? day(p.paidDate) : null } })
        }
      } else if (row.status === 'paid') {
        await db.payment.update({ where: { id: p.id }, data: { status: 'pending', paidDate: null } })
      }
    }
  }

  for (const line of lines) {
    if (isCounted(line)) continue
    const d = readDetails(line)
    if (d.allocations.length > 0 || d.credit !== 0 || line.paymentId !== null) {
      await db.bankTransaction.update({
        where: { id: line.id },
        data: { details: asJson({ ...d, allocations: [], credit: 0, shortfall: 0 }), paymentId: null },
      })
    }
  }
}

// ---- Import ----

export interface ImportResult {
  batch: string
  fileName: string
  alreadyImported: boolean
  /** Lines read from the file. */
  lines: number
  newLines: number
  /** Lines skipped because they were imported before. */
  skippedLines: number
  matched: number
  exceptions: number
  suggestions: number
  method: 'rules' | 'rules+model'
  errors: ParseError[]
}

export async function importStatement(
  userId: number,
  fileName: string,
  text: string,
  options: { suggest?: boolean } = {},
): Promise<ImportResult> {
  const parsed = parseStatement(text)
  if (parsed.lines.length === 0) {
    const reason = parsed.errors[0]?.message ?? 'The file has no transactions.'
    throw new ReconciliationError(`No transactions could be read. ${reason}`, 400, parsed.errors)
  }
  const hashes = lineHashes(parsed.lines)
  const batch = batchId(fileName, parsed.lines)
  const known = await prisma.bankTransaction.findMany({
    where: { userId, lineHash: { in: hashes } },
    select: { lineHash: true, importBatch: true },
  })
  const knownHashes = new Set(known.map((k) => k.lineHash))
  const fresh = parsed.lines.map((line, i) => ({ line, hash: hashes[i] })).filter((x) => !knownHashes.has(x.hash))
  const base = { fileName, lines: parsed.lines.length, skippedLines: parsed.lines.length - fresh.length, errors: parsed.errors }

  if (fresh.length === 0) {
    return { ...base, batch: known[0]?.importBatch ?? batch, alreadyImported: true, newLines: 0, matched: 0, exceptions: 0, suggestions: 0, method: 'rules' }
  }

  let ids: number[]
  try {
    ids = await prisma.$transaction(
      async (tx) => {
        const { snapshot } = await loadPortfolio(userId, tx)
        const { results } = reconcile(
          fresh.map((f) => f.line),
          snapshot,
        )
        const created: number[] = []
        for (const [i, { line, hash }] of fresh.entries()) {
          const r = results[i]
          const details: LineDetails = {
            fileName,
            row: line.row,
            tranType: line.tranType,
            method: r.method,
            confidence: r.confidence,
            leaseId: r.leaseId,
            propertyId: r.propertyId,
            contractorId: r.contractorId,
            jobId: r.jobId,
            category: r.category,
            allocatable: r.allocatable,
            allocations: r.allocations,
            credit: r.credit,
            shortfall: r.shortfall,
            explanation: r.explanation,
            suggestedAction: r.suggestedAction,
            candidates: r.candidates,
            duplicateOf: r.duplicateOf,
            touchedPayments: r.allocations.map((a) => a.paymentId),
            engine: { matchStatus: r.matchStatus, matchType: r.matchType, exception: r.exception, leaseId: r.leaseId, jobId: r.jobId },
          }
          const row = await tx.bankTransaction.create({
            data: {
              userId,
              importBatch: batch,
              date: day(line.date),
              amount: line.amount,
              description: line.payee,
              particulars: line.particulars || null,
              code: line.code || null,
              reference: line.reference || null,
              matchStatus: r.matchStatus,
              matchType: r.matchType,
              exception: r.exception,
              paymentId: r.allocations[0]?.paymentId ?? null,
              lineHash: hash,
              details: asJson(details),
            },
            select: { id: true },
          })
          created.push(row.id)
        }
        await refreshLedger(userId, tx)
        return created
      },
      { timeout: 60_000, maxWait: 10_000 },
    )
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ReconciliationError('This statement is already being imported. Refresh in a moment.', 409)
    }
    throw e
  }

  const saved = await prisma.bankTransaction.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })
  for (const line of saved) {
    if (line.matchStatus === 'matched' && !line.exception) {
      await recordRun({ userId, automation: AUTOMATION, itemRef: `bank:${line.id}`, outcome: 'auto' })
    }
  }

  let suggestions = 0
  if ((options.suggest ?? true) && aiEnabled()) {
    suggestions = await addSuggestions(userId, saved.filter(needsSuggestion))
  }

  return {
    ...base,
    batch,
    alreadyImported: false,
    newLines: saved.length,
    matched: saved.filter((l) => l.matchStatus === 'matched').length,
    exceptions: saved.filter((l) => l.matchStatus === 'exception').length,
    suggestions,
    method: suggestions > 0 ? 'rules+model' : 'rules',
  }
}

// ---- Model suggestions ----

const needsSuggestion = (line: BankTransaction) =>
  line.matchStatus === 'exception' && (line.exception === 'unknown_payer' || (line.exception === 'ambiguous' && line.matchType === 'rent'))

const codeOf = (lease: LeaseRef) => lease.propertyCode ?? `LEASE${lease.id}`

export function suggestionInput(line: BankTransaction, portfolio: Portfolio, asOf: string): SuggestionInput {
  const { snapshot, lines } = portfolio
  const d = readDetails(line)
  const sameBatch = lines.filter((l) => l.importBatch === line.importBatch && l.id !== line.id && isCounted(l))
  return {
    line: toStatementLine(line),
    tenancies: snapshot.leases.map((lease) => ({
      code: codeOf(lease),
      tenant: `${lease.tenantFirstName} ${lease.tenantLastName}`,
      address: lease.address,
      weeklyRent: lease.weeklyRent,
      rentReference: lease.rentReference,
      status: lease.status,
      endDate: lease.endDate,
      owingAtStatementEnd: round2(
        snapshot.payments.filter((p) => p.leaseId === lease.id && p.dueDate <= asOf).reduce((s, p) => s + outstanding(p), 0),
      ),
      creditHeld: round2(
        lines
          .filter((l) => isCounted(l) && readDetails(l).leaseId === lease.id)
          .reduce((s, l) => s + readDetails(l).credit, 0),
      ),
    })),
    payersSeen: sameBatch.flatMap((l) => {
      const lease = snapshot.leases.find((x) => x.id === readDetails(l).leaseId)
      if (!lease) return []
      return [
        {
          code: codeOf(lease),
          payer: l.description,
          reference: [l.particulars, l.code, l.reference].filter(Boolean).join(' / '),
          date: iso(l.date),
          amount: l.amount,
        },
      ]
    }),
    rules: { exception: line.exception ?? '', explanation: d.explanation, candidates: d.candidates.map((c) => `${c.label}: ${c.why}`) },
  }
}

/** Asks the model about each line and stores its answer as a suggestion. Returns how many usable suggestions came back. */
export async function addSuggestions(userId: number, lines: BankTransaction[]): Promise<number> {
  if (lines.length === 0) return 0
  const portfolio = await loadPortfolio(userId)
  const asOf = portfolio.lines.reduce((max, l) => (iso(l.date) > max ? iso(l.date) : max), '0000-00-00')
  let usable = 0
  for (const line of lines) {
    const suggestion = await suggestForLine(suggestionInput(line, portfolio, asOf))
    const leases = portfolio.snapshot.leases.filter((l) => codeOf(l) === suggestion.tenancy)
    const leaseId = leases.length ? pickLease(leases, iso(line.date)).id : null
    const stored: AiSuggestion = { ...suggestion, leaseId }
    await prisma.bankTransaction.update({ where: { id: line.id }, data: { aiSuggestion: asJson(stored) } })
    if (suggestion.status === 'ok') usable++
  }
  return usable
}

// ---- Decisions ----

export interface ResolveInput {
  decision: 'accept' | 'reassign' | 'ignore'
  leaseId?: number
  jobId?: number
  note?: string
  reviewSeconds: number
}

/**
 * A person's decision on a line. Accept keeps what the engine proposed; reassign puts the money on another
 * tenancy (or links a payment to another job); ignore leaves the line out of the ledger. The rent ledger is rebuilt
 * afterwards, and the review time is added to the line's automation run.
 */
export async function resolveLine(userId: number, id: number, input: ResolveInput) {
  const line = await prisma.bankTransaction.findFirst({ where: { id, userId } })
  if (!line) throw new ReconciliationError('Bank line not found.', 404)
  const d = readDetails(line)
  const next: LineDetails = { ...d }
  let matchStatus = line.matchStatus
  let matchType = line.matchType

  if (input.decision === 'accept') {
    if (line.exception === 'unknown_payer' || (line.exception === 'ambiguous' && d.leaseId === null && d.jobId === null)) {
      throw new ReconciliationError('There is nothing to accept on this line: choose a tenancy or job (reassign), or leave it out (ignore).')
    }
    if (line.exception === 'duplicate') {
      matchStatus = 'ignored'
      next.allocatable = false
    } else {
      matchStatus = 'matched'
    }
  } else if (input.decision === 'reassign') {
    if (input.leaseId) {
      const lease = await prisma.lease.findFirst({ where: { id: input.leaseId, property: { userId } } })
      if (!lease) throw new ReconciliationError('That tenancy was not found.', 404)
      if (line.amount <= 0) throw new ReconciliationError('Only money in can be put towards rent.')
      Object.assign(next, { leaseId: lease.id, propertyId: lease.propertyId, allocatable: true, method: 'person', confidence: 1, jobId: null, contractorId: null, category: null })
      matchType = 'rent'
    } else if (input.jobId) {
      const job = await prisma.maintenanceRequest.findFirst({ where: { id: input.jobId, property: { userId } } })
      if (!job) throw new ReconciliationError('That job was not found.', 404)
      Object.assign(next, { jobId: job.id, propertyId: job.propertyId, contractorId: job.contractorId ?? d.contractorId, leaseId: null, allocatable: false, method: 'person', confidence: 1 })
      matchType = 'contractor'
    } else {
      throw new ReconciliationError('Reassigning needs a tenancy (leaseId) or a job (jobId).')
    }
    matchStatus = 'matched'
  } else {
    matchStatus = 'ignored'
    next.allocatable = false
  }

  const engineTarget = d.engine.leaseId ?? d.engine.jobId
  const newTarget = next.leaseId ?? next.jobId
  const outcome: RunOutcome =
    input.decision === 'reassign' && engineTarget !== null && engineTarget !== newTarget
      ? 'corrected'
      : input.decision === 'ignore' && d.engine.matchStatus === 'matched' && !d.engine.exception
        ? 'rejected'
        : 'reviewed'
  const reviewSeconds = Math.max(0, Math.round(input.reviewSeconds))
  const resolution: Resolution = {
    decision: input.decision,
    leaseId: next.leaseId,
    jobId: next.jobId,
    note: input.note?.trim() || null,
    reviewSeconds,
    outcome,
    at: new Date().toISOString(),
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.bankTransaction.update({
        where: { id: line.id },
        data: { matchStatus, matchType, details: asJson(next), resolution: asJson(resolution) },
      })
      await refreshLedger(userId, tx)
    },
    { timeout: 60_000, maxWait: 10_000 },
  )

  const itemRef = `bank:${line.id}`
  const reviewed = await recordReview(itemRef, reviewSeconds, outcome)
  if (!reviewed) await recordRun({ userId, automation: AUTOMATION, itemRef, outcome, reviewSeconds })

  const [view] = await describeLines(userId, await prisma.bankTransaction.findMany({ where: { id: line.id } }))
  return view
}

// ---- Views ----

export interface LineView {
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
  matchStatus: string
  matchType: string | null
  category: string | null
  exception: ExceptionCode | null
  exceptionLabel: string | null
  method: MatchMethod
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
  engine: LineDetails['engine']
}

export async function describeLines(userId: number, lines: BankTransaction[]): Promise<LineView[]> {
  const leases = await prisma.lease.findMany({ where: { property: { userId } }, include: { tenant: true, property: true } })
  const jobs = await prisma.maintenanceRequest.findMany({ where: { property: { userId } }, include: { property: true } })
  const contractors = await prisma.contractor.findMany({ where: { userId } })
  return lines.map((line) => {
    const d = readDetails(line)
    const lease = leases.find((l) => l.id === d.leaseId)
    const job = jobs.find((j) => j.id === d.jobId)
    const contractor = contractors.find((c) => c.id === (d.contractorId ?? job?.contractorId))
    const exception = (EXCEPTION_CODES as readonly string[]).includes(line.exception ?? '') ? (line.exception as ExceptionCode) : null
    return {
      id: line.id,
      batch: line.importBatch,
      row: d.row,
      date: iso(line.date),
      amount: line.amount,
      payee: line.description,
      particulars: line.particulars ?? '',
      code: line.code ?? '',
      reference: line.reference ?? '',
      tranType: d.tranType,
      matchStatus: line.matchStatus,
      matchType: line.matchType,
      category: d.category,
      exception,
      exceptionLabel: exception ? EXCEPTION_LABELS[exception] : null,
      method: d.method,
      methodLabel: METHOD_LABELS[d.method] ?? d.method,
      confidence: d.confidence,
      lease: lease
        ? {
            id: lease.id,
            label: leaseLabel({ ...leaseRefOf(lease) }),
            tenant: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
            propertyCode: lease.property.code,
            address: lease.property.address,
            ended: lease.status === 'ended',
          }
        : null,
      job: job ? { id: job.id, label: `${job.title}, ${job.property.address}${job.property.code ? ` (${job.property.code})` : ''}`, quoteAmount: job.quoteAmount } : null,
      contractor: contractor ? { id: contractor.id, name: contractor.name } : null,
      allocations: d.allocations,
      credit: d.credit,
      shortfall: d.shortfall,
      explanation: d.explanation,
      suggestedAction: d.suggestedAction,
      candidates: d.candidates,
      duplicateOf: d.duplicateOf,
      aiSuggestion: (line.aiSuggestion as AiSuggestion | null) ?? null,
      resolution: (line.resolution as Resolution | null) ?? null,
      engine: d.engine,
    }
  })
}

function leaseRefOf(lease: { id: number; propertyId: number; weeklyRent: number; rentReference: string | null; status: string; startDate: Date; endDate: Date | null; tenant: { firstName: string; lastName: string }; property: { code: string | null; address: string; suburb: string } }): LeaseRef {
  return {
    id: lease.id,
    propertyId: lease.propertyId,
    propertyCode: lease.property.code,
    address: lease.property.address,
    suburb: lease.property.suburb,
    tenantFirstName: lease.tenant.firstName,
    tenantLastName: lease.tenant.lastName,
    weeklyRent: lease.weeklyRent,
    rentReference: lease.rentReference,
    status: lease.status,
    startDate: iso(lease.startDate),
    endDate: lease.endDate ? iso(lease.endDate) : null,
  }
}

export type StatusFilter = 'all' | 'exception' | 'matched' | 'ignored' | 'resolved'

export async function listTransactions(userId: number, batch: string | undefined, status: StatusFilter = 'all'): Promise<LineView[]> {
  const where: Prisma.BankTransactionWhereInput = { userId, ...(batch ? { importBatch: batch } : {}) }
  if (status === 'exception') where.matchStatus = 'exception'
  if (status === 'matched') where.matchStatus = 'matched'
  if (status === 'ignored') where.matchStatus = 'ignored'
  if (status === 'resolved') Object.assign(where, { exception: { not: null }, matchStatus: { not: 'exception' } })
  const lines = await prisma.bankTransaction.findMany({ where, orderBy: [{ date: 'asc' }, { id: 'asc' }] })
  return describeLines(userId, lines)
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

export async function listBatches(userId: number): Promise<BatchInfo[]> {
  const lines = await prisma.bankTransaction.findMany({
    where: { userId },
    select: { importBatch: true, date: true, createdAt: true, matchStatus: true, details: true },
    orderBy: { id: 'asc' },
  })
  const batches = new Map<string, BatchInfo>()
  for (const l of lines) {
    const b = batches.get(l.importBatch) ?? {
      batch: l.importBatch,
      fileName: readDetails(l).fileName,
      periodStart: iso(l.date),
      periodEnd: iso(l.date),
      lines: 0,
      openExceptions: 0,
      importedAt: l.createdAt.toISOString(),
    }
    b.lines++
    if (l.matchStatus === 'exception') b.openExceptions++
    if (iso(l.date) < b.periodStart) b.periodStart = iso(l.date)
    if (iso(l.date) > b.periodEnd) b.periodEnd = iso(l.date)
    batches.set(l.importBatch, b)
  }
  return [...batches.values()].sort((a, b) => b.importedAt.localeCompare(a.importedAt) || b.periodEnd.localeCompare(a.periodEnd))
}

export async function latestBatch(userId: number): Promise<string | null> {
  return (await listBatches(userId))[0]?.batch ?? null
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
  exceptions: { open: number; resolved: number; byReason: { reason: ExceptionCode; label: string; open: number; resolved: number; amount: number }[] }
  byType: Record<string, number>
  arrears: { asOf: string; total: number; tenants: ArrearsRow[] }
  credits: { total: number; tenants: { leaseId: number; tenant: string; propertyCode: string | null; amount: number }[] }
  method: { label: string; rules: true; model: { enabled: boolean; name: string | null; suggestions: number } }
}

export async function batchSummary(userId: number, batch: string): Promise<BatchSummary | null> {
  const portfolio = await loadPortfolio(userId)
  const lines = portfolio.lines.filter((l) => l.importBatch === batch)
  if (lines.length === 0) return null
  const dates = lines.map((l) => iso(l.date)).sort()
  const asOf = dates[dates.length - 1]
  const views = lines.map((l) => ({ line: l, d: readDetails(l) }))

  const automatically = views.filter(({ line }) => line.matchStatus === 'matched' && !line.resolution && !line.exception).length
  const afterReview = views.filter(({ line }) => line.matchStatus === 'matched' && (line.resolution || line.exception)).length
  const byReason = EXCEPTION_CODES.map((reason) => {
    const flagged = views.filter(({ d, line }) => (d.engine.exception ?? line.exception) === reason)
    return {
      reason,
      label: EXCEPTION_LABELS[reason],
      open: flagged.filter(({ line }) => line.matchStatus === 'exception').length,
      resolved: flagged.filter(({ line }) => line.matchStatus !== 'exception').length,
      amount: round2(flagged.reduce((s, { line }) => s + line.amount, 0)),
    }
  }).filter((r) => r.open + r.resolved > 0)
  const byType: Record<string, number> = {}
  for (const { line } of views) {
    const key = line.matchType ?? 'unmatched'
    byType[key] = (byType[key] ?? 0) + 1
  }

  const { snapshot } = portfolio
  const arrears = computeArrears(snapshot.leases, snapshot.payments, asOf)
  const credits = new Map<number, number>()
  for (const l of portfolio.lines) {
    if (!isCounted(l) || iso(l.date) > asOf) continue
    const d = readDetails(l)
    if (d.leaseId !== null && d.credit > 0) credits.set(d.leaseId, round2((credits.get(d.leaseId) ?? 0) + d.credit))
  }
  const creditRows = [...credits.entries()].map(([leaseId, amount]) => {
    const lease = snapshot.leases.find((l) => l.id === leaseId)!
    return { leaseId, tenant: `${lease.tenantFirstName} ${lease.tenantLastName}`, propertyCode: lease.propertyCode, amount }
  })

  const suggestions = lines.filter((l) => (l.aiSuggestion as AiSuggestion | null)?.status === 'ok').length
  const total = automatically + afterReview
  return {
    batch,
    fileName: views[0].d.fileName,
    period: { start: dates[0], end: asOf },
    importedAt: lines.reduce((min, l) => (l.createdAt < min ? l.createdAt : min), lines[0].createdAt).toISOString(),
    lines: lines.length,
    moneyIn: round2(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0)),
    moneyOut: round2(lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0)),
    matched: { automatically, afterReview, total, percent: round2((total / lines.length) * 100) },
    ignored: lines.filter((l) => l.matchStatus === 'ignored').length,
    exceptions: {
      open: lines.filter((l) => l.matchStatus === 'exception').length,
      resolved: lines.filter((l) => l.exception && l.matchStatus !== 'exception').length,
      byReason,
    },
    byType,
    arrears: { asOf, total: round2(arrears.reduce((s, a) => s + a.total, 0)), tenants: arrears },
    credits: { total: round2(creditRows.reduce((s, c) => s + c.amount, 0)), tenants: creditRows },
    method: {
      label: suggestions > 0 ? 'Rules, with model suggestions for lines the rules could not place' : 'Rules',
      rules: true,
      model: { enabled: aiEnabled(), name: aiEnabled() ? aiConfig().model : null, suggestions },
    },
  }
}
