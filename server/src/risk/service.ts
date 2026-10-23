// Arrears risk with the database: score every active tenancy from its RentMonth rows, store the result as a
// draft next step, and record a person's decision (approve or dismiss) with review time and an audit event.
import type { Prisma } from '@prisma/client'
import { assertCanApprove, type Actor } from '../lib/actor'
import { audit } from '../lib/audit'
import { recordReview, recordRun } from '../lib/automation'
import { prisma } from '../lib/prisma'
import { computeFeatures, monthlyRent, type Features } from './features'
import { draftFor, loadModel, NEXT_STEP_LABELS, score, type NextStep, type Reason } from './model'

export class RiskError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const AUTOMATION = 'risk_review' as const
export const itemRef = (id: number) => `risk:${id}`
const json = (value: unknown) => value as Prisma.InputJsonValue

const RELATIONS = {
  tenant: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  lease: { select: { id: true, weeklyRent: true, startDate: true, property: { select: { id: true, code: true, address: true, suburb: true, city: true, marketRent: true } } } },
} as const

export interface ScoreSummary {
  scored: number
  asOf: string
  bands: Record<string, number>
  modelVersion: string
}

/** The latest month with rent history for the organisation (YYYY-MM), or null when there is none. */
export async function latestMonth(organisationId: number): Promise<string | null> {
  const last = await prisma.rentMonth.findFirst({ where: { organisationId }, orderBy: { month: 'desc' }, select: { month: true } })
  return last?.month ?? null
}

/**
 * Scores every active tenancy with rent history as of a month (default: the latest month on file). A tenancy keeps
 * its decision when the band and the next step are unchanged; otherwise it goes back to draft for a person.
 */
export async function scoreOrganisation(actor: Actor, asOf?: string): Promise<ScoreSummary> {
  const model = loadModel()
  const month = asOf ?? (await latestMonth(actor.organisationId))
  if (!month) return { scored: 0, asOf: '', bands: {}, modelVersion: model.version }
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: actor.organisationId }, select: { name: true, currency: true } })
  const leases = await prisma.lease.findMany({
    where: { status: 'active', property: { organisationId: actor.organisationId }, rentMonths: { some: {} } },
    include: { tenant: true, property: true, rentMonths: { orderBy: { month: 'asc' } } },
  })
  const bands: Record<string, number> = { low: 0, medium: 0, high: 0 }
  for (const lease of leases) {
    const rentMonthly = monthlyRent(lease.weeklyRent)
    const rows = lease.rentMonths.filter((r) => r.month <= month)
    if (!rows.length) continue
    const features = computeFeatures(
      { start: lease.startDate, rentMonthly, marketMonthly: lease.property.marketRent ? monthlyRent(lease.property.marketRent) : null, rows },
      month,
    )
    const result = score(model, features, { months: rows.length, rentMonthly, currency: org.currency })
    const behind = Math.max(0, features.balance_ratio * rentMonthly)
    const draft = draftFor(result.nextStep, {
      firstName: lease.tenant.firstName,
      address: `${lease.property.address}, ${lease.property.suburb}`,
      company: org.name,
      behind,
      currency: org.currency,
      reasons: result.reasons,
    })
    bands[result.band]++
    const existing = await prisma.tenantRisk.findUnique({ where: { tenantId_leaseId: { tenantId: lease.tenantId, leaseId: lease.id } } })
    const unchanged = existing && existing.band === result.band && existing.nextStep === result.nextStep && existing.status !== 'draft'
    const data = {
      organisationId: actor.organisationId,
      tenantId: lease.tenantId,
      leaseId: lease.id,
      scoredAt: new Date(),
      asOfMonth: month,
      probability: result.probability,
      band: result.band,
      reasons: json(result.reasons),
      features: json(features),
      nextStep: result.nextStep,
      draft: unchanged ? existing.draft : draft,
      status: unchanged ? existing.status : 'draft',
      modelVersion: model.version,
    }
    const saved = await prisma.tenantRisk.upsert({ where: { tenantId_leaseId: { tenantId: lease.tenantId, leaseId: lease.id } }, create: data, update: data })
    if (!existing || !unchanged) {
      await audit({
        actor,
        action: 'risk.scored',
        entity: 'risk',
        entityId: saved.id,
        before: existing ? { band: existing.band, probability: existing.probability } : undefined,
        after: { band: result.band, probability: Math.round(result.probability * 1000) / 1000, nextStep: result.nextStep, reasons: result.reasons.map((r) => r.text) },
        note: `${lease.tenant.firstName} ${lease.tenant.lastName} (${lease.property.code ?? lease.property.address}): ${result.band} risk, ${NEXT_STEP_LABELS[result.nextStep].toLowerCase()}.`,
      })
      // Only tenancies with a suggested step are work a person would otherwise do by hand.
      if (result.nextStep !== 'none') {
        const run = await prisma.automationRun.findFirst({ where: { itemRef: itemRef(saved.id) } })
        if (!run) await recordRun({ actor, automation: AUTOMATION, itemRef: itemRef(saved.id), outcome: 'auto' })
      }
    }
  }
  return { scored: leases.length, asOf: month, bands, modelVersion: model.version }
}

export async function listRisks(organisationId: number, band?: string) {
  return prisma.tenantRisk.findMany({
    where: { organisationId, ...(band ? { band } : {}) },
    include: RELATIONS,
    orderBy: [{ probability: 'desc' }, { id: 'asc' }],
  })
}

/** The month-by-month history behind one score, for the drawer in the Risk tab. */
export async function riskHistory(organisationId: number, id: number) {
  const risk = await prisma.tenantRisk.findFirst({ where: { id, organisationId }, include: RELATIONS })
  if (!risk) throw new RiskError(404, 'Risk score not found')
  const rows = await prisma.rentMonth.findMany({ where: { leaseId: risk.leaseId }, orderBy: { month: 'asc' } })
  return { ...risk, history: rows }
}

const seconds = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 4 * 3600) : 0
}

/** A person approves the next step (edited or not). Nothing is sent: the draft is stored as approved. */
export async function reviewRisk(actor: Actor, id: number, body: { decision?: unknown; draft?: unknown; nextStep?: unknown; note?: unknown; reviewSeconds?: unknown }) {
  const risk = await prisma.tenantRisk.findFirst({ where: { id, organisationId: actor.organisationId }, include: RELATIONS })
  if (!risk) throw new RiskError(404, 'Risk score not found')
  if (risk.status !== 'draft') throw new RiskError(409, `This next step is already ${risk.status}.`)
  assertCanApprove(actor, 'workOrder', null)
  const decision = body.decision === 'dismiss' ? 'dismissed' : 'approved'
  const steps: NextStep[] = ['none', 'reminder', 'call', 'payment_plan']
  const nextStep = typeof body.nextStep === 'string' && steps.includes(body.nextStep as NextStep) ? (body.nextStep as NextStep) : risk.nextStep
  const draft = typeof body.draft === 'string' && body.draft.trim() ? body.draft.trim().slice(0, 4000) : risk.draft
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
  const changed = nextStep !== risk.nextStep || draft !== risk.draft
  const reviewSeconds = seconds(body.reviewSeconds)
  const updated = await prisma.tenantRisk.update({
    where: { id },
    data: { status: decision, nextStep, draft, note: note || null, approvedAt: new Date(), reviewSeconds: (risk.reviewSeconds ?? 0) + reviewSeconds },
    include: RELATIONS,
  })
  const outcome = decision === 'dismissed' ? 'rejected' : changed ? 'corrected' : 'reviewed'
  const reviewed = await recordReview(itemRef(id), reviewSeconds, outcome)
  if (!reviewed && risk.nextStep !== 'none') await recordRun({ actor, automation: AUTOMATION, itemRef: itemRef(id), outcome, reviewSeconds })
  await audit({
    actor,
    action: decision === 'dismissed' ? 'risk.dismissed' : 'risk.approved',
    entity: 'risk',
    entityId: id,
    field: changed ? 'nextStep' : null,
    before: changed ? { nextStep: risk.nextStep, draft: risk.draft } : undefined,
    after: changed ? { nextStep, draft } : undefined,
    note:
      `${risk.tenant.firstName} ${risk.tenant.lastName}: ${NEXT_STEP_LABELS[nextStep as NextStep].toLowerCase()} ${decision}` +
      (changed ? ' after editing' : '') +
      (note ? `; ${note}` : '') +
      '.',
  })
  return updated
}

export type { Features, Reason }
