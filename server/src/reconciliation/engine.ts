// The matching engine: decides what each bank line is, without a model and without a database.
//
// Money in, in this order:
//   - a line identical to an earlier one is a possible duplicate and is held;
//   - from a known contractor: a credit from that contractor;
//   - the word BOND: a bond receipt (to lodge, not rent);
//   - rent, matched in order of confidence:
//       1. the reference names a tenancy (its rent reference, or the property code);
//       2. the payer name matches a tenant (surname, with the first name or initial);
//       3. the amount is one or two weeks' rent of exactly one tenancy with rent due around the payment date;
//   - money for an ended tenancy, conflicting evidence, or no evidence is held for a person.
// Money out: contractor payments matched to maintenance jobs by contractor, property and quote; bank fees;
// refunds to tenants; transfers. Anything else is held for a person.
import { allocate, classifyRent, outstanding, POLICY } from './allocate'
import { lineKey } from './csv'
import { addDays, money, nameStrength, type NameStrength, normalise, nzDate, round2, sameMoney, tokenSet, tokens } from './text'
import type {
  Candidate,
  ContractorRef,
  JobRef,
  LeaseRef,
  LineResult,
  MatchMethod,
  RentPayment,
  Snapshot,
  StatementLine,
} from './types'

export const CONFIDENCE = {
  referenceFull: 0.98,
  referenceCode: 0.9,
  nameStrong: 0.9,
  nameMedium: 0.8,
  nameWeakWithAmount: 0.75,
  amountOneWeek: 0.6,
  amountTwoWeeks: 0.55,
  contractorJob: 0.97,
  contractorAmountOnly: 0.85,
  keyword: 0.95,
}

const tenantName = (l: LeaseRef) => `${l.tenantFirstName} ${l.tenantLastName}`
export const leaseLabel = (l: LeaseRef) => `${tenantName(l)}, ${l.address}${l.propertyCode ? ` (${l.propertyCode})` : ''}`
const jobLabel = (j: JobRef) => `${j.title}, ${j.address}${j.propertyCode ? ` (${j.propertyCode})` : ''}`
const compactCode = (code: string | null) => normalise(code).replace(/ /g, '')
const lineText = (line: StatementLine) => `${line.particulars} ${line.code} ${line.reference}`
const shown = (line: StatementLine) => [line.particulars, line.code, line.reference].filter(Boolean).join(' / ') || '(none)'

function isEnded(lease: LeaseRef, date: string): boolean {
  if (lease.endDate) return lease.endDate < date
  return lease.status === 'ended'
}

/** The lease for this property on this date: the one running then, else the most recent. */
export function pickLease(leases: LeaseRef[], date: string): LeaseRef {
  const running = leases.filter((l) => !isEnded(l, date))
  const pool = running.length ? running : leases
  return [...pool].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
}

interface State {
  snapshot: Snapshot
  payments: Map<number, RentPayment[]>
  seen: Map<string, string>
  done: { row: number; date: string; amount: number; leaseId: number | null; exception: string | null }[]
}

function newState(snapshot: Snapshot): State {
  const payments = new Map<number, RentPayment[]>()
  for (const p of snapshot.payments) {
    const copy = { ...p }
    payments.set(p.leaseId, [...(payments.get(p.leaseId) ?? []), copy])
  }
  const seen = new Map<string, string>()
  for (const prior of snapshot.priorLines) if (!seen.has(prior.key)) seen.set(prior.key, prior.label)
  return { snapshot, payments, seen, done: [] }
}

function blank(line: StatementLine): LineResult {
  return {
    row: line.row,
    matchStatus: 'matched',
    matchType: null,
    exception: null,
    method: 'none',
    confidence: 0,
    leaseId: null,
    propertyId: null,
    contractorId: null,
    jobId: null,
    category: null,
    allocatable: false,
    allocations: [],
    credit: 0,
    shortfall: 0,
    explanation: '',
    suggestedAction: null,
    candidates: [],
    duplicateOf: null,
  }
}

const leaseCandidate = (lease: LeaseRef, why: string): Candidate => ({ kind: 'lease', id: lease.id, label: leaseLabel(lease), why })
const jobCandidate = (job: JobRef, why: string): Candidate => ({ kind: 'job', id: job.id, label: jobLabel(job), why })

// ---- Rent: who is it from? ----

/** Tier 1: the reference, particulars or code name a tenancy. Several properties named at once is ambiguous. */
function byReference(line: StatementLine, leases: LeaseRef[]): { leases: LeaseRef[]; full: boolean } {
  const text = tokenSet(lineText(line))
  const full = leases.filter((l) => {
    const ref = tokens(l.rentReference)
    return ref.length > 0 && ref.every((t) => text.has(t))
  })
  const code = leases.filter((l) => l.propertyCode && text.has(compactCode(l.propertyCode)))
  const hits = full.length ? full : code
  const byProperty = new Map<number, LeaseRef[]>()
  for (const l of hits) byProperty.set(l.propertyId, [...(byProperty.get(l.propertyId) ?? []), l])
  return { leases: [...byProperty.values()].map((group) => pickLease(group, line.date)), full: full.length > 0 }
}

interface NameHit {
  lease: LeaseRef
  strength: NameStrength
}

/** Tier 2: the payer name (or, failing that, a full name in the particulars or reference). */
function byName(line: StatementLine, leases: LeaseRef[]): NameHit[] {
  const tenants = new Map<string, LeaseRef[]>()
  for (const l of leases) {
    const key = `${normalise(l.tenantFirstName)}|${normalise(l.tenantLastName)}`
    tenants.set(key, [...(tenants.get(key) ?? []), l])
  }
  const hits: NameHit[] = []
  for (const group of tenants.values()) {
    const strength = nameStrength(line.payee, group[0].tenantFirstName, group[0].tenantLastName)
    if (strength) hits.push({ lease: pickLease(group, line.date), strength })
  }
  if (hits.length === 0) {
    for (const group of tenants.values()) {
      if (nameStrength(lineText(line), group[0].tenantFirstName, group[0].tenantLastName) === 'strong') {
        hits.push({ lease: pickLease(group, line.date), strength: 'medium' })
      }
    }
  }
  const rank = { strong: 3, medium: 2, weak: 1 }
  const best = Math.max(0, ...hits.map((h) => rank[h.strength]))
  return hits.filter((h) => rank[h.strength] === best)
}

/** Tier 3: one or two weeks' rent of a running tenancy that has rent due around the payment date. */
function byAmount(line: StatementLine, state: State): { lease: LeaseRef; weeks: number }[] {
  const from = addDays(line.date, -POLICY.windowBeforeDays)
  const to = addDays(line.date, POLICY.windowAfterDays)
  const hits: { lease: LeaseRef; weeks: number }[] = []
  for (const lease of state.snapshot.leases) {
    if (isEnded(lease, line.date) || lease.weeklyRent <= 0) continue
    const weeks = [1, 2].find((k) => sameMoney(line.amount, k * lease.weeklyRent))
    if (!weeks) continue
    const due = (state.payments.get(lease.id) ?? []).some((p) => p.dueDate >= from && p.dueDate <= to && outstanding(p) > 0)
    if (due) hits.push({ lease, weeks })
  }
  return hits
}

/** First names (three letters or more) in the line's text: a hint for a person, never a match on its own. */
function firstNameHints(line: StatementLine, leases: LeaseRef[]): Candidate[] {
  const words = new Set(tokens(`${line.payee} ${lineText(line)}`))
  return leases
    .filter((l) => !isEnded(l, line.date))
    .filter((l) => {
      const first = tokens(l.tenantFirstName)[0]
      return first && first.length >= 3 && words.has(first)
    })
    .map((l) => leaseCandidate(l, `first name "${l.tenantFirstName}" appears in the line`))
}

// ---- Rent: apply it ----

function describeAllocations(result: LineResult, payments: RentPayment[]): string {
  if (result.allocations.length === 0) return `No rent was due, so ${money(result.credit)} is held as credit.`
  const parts = result.allocations.map((a) => {
    const p = payments.find((x) => x.id === a.paymentId)!
    const left = outstanding(p)
    return `${money(a.amount)} to the week due ${nzDate(a.dueDate)} (${left > 0 ? `part-paid, ${money(left)} still owing` : 'now paid'})`
  })
  const allFull = result.allocations.every((a) => a.completes)
  let text: string
  if (allFull && result.allocations.length === 1) text = `Pays the rent due ${nzDate(result.allocations[0].dueDate)}.`
  else if (allFull && result.allocations.length === 2) text = `Pays two weeks: ${result.allocations.map((a) => nzDate(a.dueDate)).join(' and ')}.`
  else if (allFull) text = `Pays ${result.allocations.length} weeks: ${result.allocations.map((a) => nzDate(a.dueDate)).join(', ')}.`
  else text = `Applied ${parts.join('; ')}.`
  if (result.credit > 0) text += ` ${money(result.credit)} is held as credit.`
  return text
}

function rentFor(line: StatementLine, lease: LeaseRef, method: MatchMethod, confidence: number, why: string, state: State): LineResult {
  const result: LineResult = {
    ...blank(line),
    matchType: 'rent',
    method,
    confidence,
    leaseId: lease.id,
    propertyId: lease.propertyId,
  }
  if (isEnded(lease, line.date)) {
    const automatic = normalise(line.tranType).includes('AUTOMATIC')
    return {
      ...result,
      matchStatus: 'exception',
      exception: 'payment_to_ended_lease',
      explanation: `${why} ${tenantName(lease)}'s tenancy at ${lease.address} ended on ${nzDate(lease.endDate ?? line.date)}, so this isn't counted as rent.`,
      suggestedAction: automatic
        ? `Refund ${money(line.amount)} to ${tenantName(lease)} and ask them to cancel the automatic payment.`
        : `Refund ${money(line.amount)} to ${tenantName(lease)}, or assign it to another tenancy if it was meant for one.`,
    }
  }
  const payments = state.payments.get(lease.id) ?? []
  const outcome = allocate(line.amount, line.date, lease.weeklyRent, payments)
  const { exception, shortfall } = classifyRent(line.amount, lease.weeklyRent, outcome)
  const allocated: LineResult = {
    ...result,
    allocatable: true,
    allocations: outcome.allocations,
    credit: outcome.credit,
    shortfall,
  }
  const applied = describeAllocations(allocated, payments)
  if (exception === 'underpaid') {
    return {
      ...allocated,
      matchStatus: 'exception',
      exception,
      explanation: `${why} ${money(line.amount)} is ${money(shortfall)} short of the weekly rent of ${money(lease.weeklyRent)}. ${applied}`,
      suggestedAction: `Ask ${tenantName(lease)} about the ${money(shortfall)} shortfall. It stays in arrears until it is paid.`,
    }
  }
  if (exception === 'overpaid') {
    return {
      ...allocated,
      matchStatus: 'exception',
      exception,
      explanation: `${why} ${money(line.amount)} is more than the rent due. ${applied}`,
      suggestedAction: `Keep ${money(outcome.credit)} as credit towards ${lease.tenantFirstName}'s next rent, or refund it if they ask.`,
    }
  }
  return { ...allocated, explanation: `${why} ${applied}` }
}

function heldRent(line: StatementLine, exception: 'ambiguous' | 'unknown_payer', candidates: Candidate[], why: string): LineResult {
  const names = candidates.map((c) => c.label)
  return {
    ...blank(line),
    matchStatus: 'exception',
    matchType: exception === 'ambiguous' ? 'rent' : null,
    exception,
    candidates,
    explanation: `${why} Not allocated.`,
    suggestedAction:
      exception === 'ambiguous'
        ? `Confirm who paid, then assign it: ${names.join(' or ')}.`
        : `Find out who paid (the bank can give the payer's details). Assign it to a tenancy once you know, or leave it out and arrange a refund if it isn't for one of your properties.`,
  }
}

function moneyIn(line: StatementLine, state: State): LineResult {
  const { leases, contractors, properties } = state.snapshot

  const contractor = findContractor(line.payee, contractors)
  if (contractor) return contractorCredit(line, contractor, state)

  if (tokens(lineText(line)).includes('BOND') || tokens(line.payee).includes('BOND')) {
    const ref = byReference(line, leases).leases
    const text = tokenSet(lineText(line))
    const property = ref.length === 1 ? properties.find((p) => p.id === ref[0].propertyId) : properties.find((p) => p.code && text.has(compactCode(p.code)))
    return {
      ...blank(line),
      matchType: 'bond',
      category: 'bond',
      method: 'keyword',
      confidence: CONFIDENCE.keyword,
      leaseId: ref.length === 1 ? ref[0].id : null,
      propertyId: property?.id ?? null,
      explanation: `Bond of ${money(line.amount)} from ${line.payee || 'the payer'}${property ? ` for ${property.address}${property.code ? ` (${property.code})` : ''}` : ''}. A bond isn't rent.`,
      suggestedAction: 'Lodge the bond with the bond centre within 23 working days of receiving it.',
    }
  }

  const ref = byReference(line, leases)
  if (ref.leases.length === 1) {
    const lease = ref.leases[0]
    return rentFor(
      line,
      lease,
      'reference',
      ref.full ? CONFIDENCE.referenceFull : CONFIDENCE.referenceCode,
      `Reference "${shown(line)}" names ${leaseLabel(lease)}.`,
      state,
    )
  }
  if (ref.leases.length > 1) {
    return heldRent(
      line,
      'ambiguous',
      ref.leases.map((l) => leaseCandidate(l, 'named in the reference')),
      `The reference "${shown(line)}" names more than one tenancy.`,
    )
  }

  const type = normalise(`${line.tranType} ${line.payee} ${line.particulars}`)
  if (/\bINTEREST\b/.test(type)) {
    return { ...blank(line), matchType: 'other', category: 'interest', method: 'keyword', confidence: CONFIDENCE.keyword, explanation: 'Interest credited by the bank.' }
  }
  if (isTransfer(line)) {
    return { ...blank(line), matchType: 'transfer', category: 'transfer', method: 'keyword', confidence: CONFIDENCE.keyword, explanation: 'Transfer into the account.' }
  }

  const names = byName(line, leases)
  const amounts = byAmount(line, state)
  const strongOrMedium = names.filter((n) => n.strength !== 'weak')
  if (strongOrMedium.length === 1) {
    const { lease, strength } = strongOrMedium[0]
    return rentFor(
      line,
      lease,
      'payer_name',
      strength === 'strong' ? CONFIDENCE.nameStrong : CONFIDENCE.nameMedium,
      `Payer "${line.payee}" matches tenant ${leaseLabel(lease)}${shown(line) === '(none)' ? '' : `; the reference "${shown(line)}" doesn't name a tenancy`}.`,
      state,
    )
  }
  if (strongOrMedium.length > 1) {
    return heldRent(
      line,
      'ambiguous',
      strongOrMedium.map((n) => leaseCandidate(n.lease, 'payer name')),
      `Payer "${line.payee}" matches more than one tenant.`,
    )
  }

  const weak = names.map((n) => n.lease)
  if (amounts.length === 1) {
    const { lease, weeks } = amounts[0]
    const rentWords = weeks === 1 ? 'the weekly rent' : 'two weeks of rent'
    if (weak.length === 0 || weak.some((l) => l.id === lease.id)) {
      const why =
        weak.length > 0
          ? `Payer "${line.payee}" shares a surname with ${tenantName(lease)} and ${money(line.amount)} is ${rentWords} for ${leaseLabel(lease)}.`
          : `No reference or payer match, but ${money(line.amount)} is ${rentWords} for ${leaseLabel(lease)} only, with rent due around ${nzDate(line.date)}.`
      return rentFor(
        line,
        lease,
        weak.length > 0 ? 'payer_name' : 'amount_window',
        weak.length > 0 ? CONFIDENCE.nameWeakWithAmount : weeks === 1 ? CONFIDENCE.amountOneWeek : CONFIDENCE.amountTwoWeeks,
        why,
        state,
      )
    }
    return heldRent(
      line,
      'ambiguous',
      [...weak.map((l) => leaseCandidate(l, 'payer surname')), leaseCandidate(lease, `amount is ${rentWords}`)],
      `The payer "${line.payee}" shares a surname with ${weak.map(tenantName).join(' and ')}, but ${money(line.amount)} is ${rentWords} for ${leaseLabel(lease)}.`,
    )
  }
  if (amounts.length > 1) {
    return heldRent(
      line,
      'ambiguous',
      amounts.map((a) => leaseCandidate(a.lease, a.weeks === 1 ? 'amount is the weekly rent' : 'amount is two weeks of rent')),
      `${money(line.amount)} matches the rent of more than one tenancy with rent due.`,
    )
  }
  const hints = [...weak.map((l) => leaseCandidate(l, 'payer surname only')), ...firstNameHints(line, leases)]
  const unique = hints.filter((h, i) => hints.findIndex((x) => x.id === h.id) === i)
  return heldRent(
    line,
    'unknown_payer',
    unique,
    `No tenancy matches the reference "${shown(line)}", the payer "${line.payee || '(blank)'}" or the amount ${money(line.amount)}.` +
      (unique.length ? ` Possible lead: ${unique.map((h) => `${h.label} (${h.why})`).join('; ')}.` : ''),
  )
}

// ---- Contractors, fees, refunds, transfers ----

const COMPANY_NOISE = new Set(['LTD', 'LIMITED', 'CO', 'COMPANY', 'NZ', 'THE', 'AND'])

export function findContractor(payee: string, contractors: ContractorRef[]): ContractorRef | null {
  const words = tokens(payee).filter((t) => !COMPANY_NOISE.has(t))
  const hits = contractors.filter((c) => {
    const name = tokens(c.name).filter((t) => !COMPANY_NOISE.has(t))
    return name.length > 0 && name.every((t) => words.includes(t))
  })
  hits.sort((a, b) => tokens(b.name).length - tokens(a.name).length)
  return hits[0] ?? null
}

function jobsMentioned(line: StatementLine, jobs: JobRef[]): JobRef[] {
  const text = tokenSet(lineText(line))
  return jobs.filter((j) => j.propertyCode && text.has(compactCode(j.propertyCode)))
}

function contractorCredit(line: StatementLine, contractor: ContractorRef, state: State): LineResult {
  const jobs = jobsMentioned(line, state.snapshot.jobs.filter((j) => j.contractorId === contractor.id))
  const job = jobs.length === 1 ? jobs[0] : null
  return {
    ...blank(line),
    matchType: 'contractor',
    category: 'contractor_credit',
    method: 'contractor',
    confidence: job ? CONFIDENCE.contractorJob : CONFIDENCE.keyword,
    contractorId: contractor.id,
    jobId: job?.id ?? null,
    propertyId: job?.propertyId ?? null,
    explanation: `Money in from ${contractor.name}${job ? ` for "${job.title}" at ${job.address}` : ''}: a credit or refund from the contractor, not rent.`,
  }
}

function contractorPayment(line: StatementLine, contractor: ContractorRef, state: State): LineResult {
  const jobs = state.snapshot.jobs.filter((j) => j.contractorId === contractor.id)
  const paid = Math.abs(line.amount)
  const base: LineResult = { ...blank(line), matchType: 'contractor', method: 'contractor', contractorId: contractor.id }
  const quoteOf = (j: JobRef) => j.quoteAmount ?? j.cost
  const byProperty = jobsMentioned(line, jobs)
  const byAmount = jobs.filter((j) => {
    const q = quoteOf(j)
    return q !== null && sameMoney(paid, q)
  })
  const both = byProperty.filter((j) => byAmount.includes(j))

  const matched = (job: JobRef, confidence: number, how: string): LineResult => ({
    ...base,
    confidence,
    jobId: job.id,
    propertyId: job.propertyId,
    explanation: `Paid ${contractor.name} ${money(paid)} for "${job.title}" at ${job.address}${job.propertyCode ? ` (${job.propertyCode})` : ''}: ${how}.`,
  })

  if (both.length === 1) return matched(both[0], CONFIDENCE.contractorJob, `the property and the quoted ${money(quoteOf(both[0])!)} both match`)
  if (byProperty.length === 0 && byAmount.length === 1) {
    return matched(byAmount[0], CONFIDENCE.contractorAmountOnly, `the amount equals the quote; the reference doesn't name the property`)
  }
  if (byProperty.length === 1 && byAmount.length === 0) {
    const job = byProperty[0]
    const quote = quoteOf(job)
    const difference = quote === null ? null : round2(paid - quote)
    return {
      ...base,
      matchStatus: 'exception',
      exception: 'amount_differs_from_quote',
      confidence: CONFIDENCE.contractorAmountOnly,
      jobId: job.id,
      propertyId: job.propertyId,
      explanation:
        quote === null
          ? `Paid ${contractor.name} ${money(paid)} for "${job.title}" at ${job.address}, which has no quote recorded.`
          : `Paid ${contractor.name} ${money(paid)} for "${job.title}" at ${job.address}, but the quote was ${money(quote)} (${money(Math.abs(difference!))} ${difference! > 0 ? 'more' : 'less'}).`,
      suggestedAction: `Check the invoice for the difference. Accept if the extra work was agreed; otherwise query ${contractor.name}.`,
    }
  }
  if (byProperty.length === 0 && byAmount.length === 0) {
    return {
      ...base,
      matchStatus: 'exception',
      exception: 'no_matching_job',
      confidence: CONFIDENCE.keyword,
      candidates: jobs.map((j) => jobCandidate(j, `${contractor.name} job, quote ${quoteOf(j) === null ? 'not recorded' : money(quoteOf(j)!)}`)),
      explanation:
        `Paid ${contractor.name} ${money(paid)}, but no ${contractor.name} job matches the property in "${shown(line)}" or the amount.` +
        (jobs.length ? ` Its jobs: ${jobs.map((j) => `${jobLabel(j)} at ${quoteOf(j) === null ? 'no quote' : money(quoteOf(j)!)}`).join('; ')}.` : ' It has no jobs on record.'),
      suggestedAction: `Find the invoice and the job it was for. If the job wasn't logged, add it under Maintenance, then link this payment to it.`,
    }
  }
  const candidates = [...new Set([...byProperty, ...byAmount])]
  return {
    ...base,
    matchStatus: 'exception',
    exception: 'ambiguous',
    candidates: candidates.map((j) => jobCandidate(j, byProperty.includes(j) ? 'property named in the reference' : 'amount equals the quote')),
    explanation: `Paid ${contractor.name} ${money(paid)}; more than one of its jobs could match.`,
    suggestedAction: `Check the invoice and link the payment to the right job.`,
  }
}

function isTransfer(line: StatementLine): boolean {
  const type = normalise(line.tranType)
  const words = tokens(`${line.payee} ${lineText(line)}`)
  return type === 'TRANSFER' || words.some((w) => ['TRANSFER', 'TFR', 'DISBURSEMENT', 'DISBURSEMENTS'].includes(w))
}

function isFee(line: StatementLine): boolean {
  const type = normalise(line.tranType)
  const words = tokens(`${line.payee} ${line.particulars} ${line.reference}`)
  return /\bFEES?\b/.test(type) || words.some((w) => ['FEE', 'FEES', 'CHARGE', 'CHARGES'].includes(w))
}

function moneyOut(line: StatementLine, state: State): LineResult {
  const { contractors, leases } = state.snapshot
  const contractor = findContractor(line.payee, contractors)
  if (contractor) return contractorPayment(line, contractor, state)

  if (isFee(line)) {
    return { ...blank(line), matchType: 'fee', category: 'fee', method: 'keyword', confidence: CONFIDENCE.keyword, explanation: `Bank fee of ${money(Math.abs(line.amount))}.` }
  }

  const named = byName(line, leases).filter((n) => n.strength !== 'weak')
  const refunded = tokens(lineText(line)).includes('REFUND')
  const ref = refunded ? byReference(line, leases).leases : []
  const lease = named.length === 1 ? named[0].lease : ref.length === 1 ? ref[0] : null
  if (lease) {
    const paidBack = Math.abs(line.amount)
    const receipt =
      state.done.find((d) => d.leaseId === lease.id && sameMoney(d.amount, paidBack) && d.date <= line.date) ??
      state.snapshot.priorLines.find((p) => p.leaseId === lease.id && sameMoney(p.amount, paidBack) && p.date <= line.date)
    return {
      ...blank(line),
      matchType: 'refund',
      category: 'refund',
      method: named.length === 1 ? 'payer_name' : 'reference',
      confidence: named.length === 1 ? CONFIDENCE.nameStrong : CONFIDENCE.referenceCode,
      leaseId: lease.id,
      propertyId: lease.propertyId,
      explanation:
        `Refund of ${money(paidBack)} to ${leaseLabel(lease)}` +
        (receipt ? `, paying back the ${money(paidBack)} received on ${nzDate(receipt.date)}.` : '.'),
    }
  }

  if (isTransfer(line)) {
    return {
      ...blank(line),
      matchType: 'transfer',
      category: 'transfer',
      method: 'keyword',
      confidence: CONFIDENCE.keyword,
      explanation: `Transfer of ${money(Math.abs(line.amount))} out of the account${line.payee ? ` to ${line.payee}` : ''}.`,
    }
  }

  return {
    ...blank(line),
    matchStatus: 'exception',
    matchType: 'other',
    exception: 'unknown_payer',
    explanation: `Money out to "${line.payee || '(blank)'}" isn't a known contractor, tenant, fee or transfer. Not categorised.`,
    suggestedAction: 'Find the invoice or approval for this payment, then categorise it.',
  }
}

// ---- Duplicates and the run over a statement ----

function probableLease(line: StatementLine, state: State): LeaseRef | null {
  const ref = byReference(line, state.snapshot.leases).leases
  if (ref.length === 1) return ref[0]
  const names = byName(line, state.snapshot.leases).filter((n) => n.strength !== 'weak')
  return names.length === 1 ? names[0].lease : null
}

function processLine(line: StatementLine, state: State): LineResult {
  const key = lineKey(line)
  const first = state.seen.get(key)
  if (first) {
    const lease = line.amount > 0 ? probableLease(line, state) : null
    const contractor = findContractor(line.payee, state.snapshot.contractors)
    return {
      ...blank(line),
      matchStatus: 'exception',
      exception: 'duplicate',
      matchType: lease ? 'rent' : contractor ? 'contractor' : null,
      method: 'duplicate',
      confidence: 0.9,
      leaseId: lease?.id ?? null,
      propertyId: lease?.propertyId ?? null,
      contractorId: contractor?.id ?? null,
      duplicateOf: first,
      explanation: `Same date, amount, payer and reference as ${first}${lease ? ` (${leaseLabel(lease)})` : ''}. Not counted again.`,
      suggestedAction: lease
        ? `Check the bank account. If the line was exported twice, leave it out. If ${tenantName(lease)} really paid twice, count it as a payment (it becomes credit).`
        : 'Check the bank account. If the line was exported twice, leave it out.',
    }
  }
  state.seen.set(key, `line ${line.row}`)
  if (line.amount === 0) {
    return { ...blank(line), matchType: 'other', category: 'zero', method: 'keyword', confidence: 1, explanation: 'Zero amount: nothing to match.' }
  }
  return line.amount > 0 ? moneyIn(line, state) : moneyOut(line, state)
}

export interface ReconcileOutput {
  results: LineResult[]
  /** The payments after this statement's money is applied. */
  payments: RentPayment[]
}

/** Matches every line of a statement, in date order, against the portfolio. Pure: the snapshot isn't changed. */
export function reconcile(lines: StatementLine[], snapshot: Snapshot): ReconcileOutput {
  const state = newState(snapshot)
  const byRow = new Map<number, LineResult>()
  const ordered = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row)
  for (const line of ordered) {
    const result = processLine(line, state)
    byRow.set(line.row, result)
    state.done.push({ row: line.row, date: line.date, amount: line.amount, leaseId: result.leaseId, exception: result.exception })
  }
  return { results: lines.map((l) => byRow.get(l.row)!), payments: [...state.payments.values()].flat() }
}
