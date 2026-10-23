// Maintenance triage with the database: a tenant's request becomes a MaintenanceRequest with its triage, a
// contractor suggestion and a draft work order; a person approves or rejects the work order (within the role's
// budget limit), which assigns the contractor. Nothing is sent to a contractor from here.
import type { Prisma } from '@prisma/client'
import { assertCanApprove, type Actor } from '../lib/actor'
import { audit } from '../lib/audit'
import { recordReview, recordRun } from '../lib/automation'
import { prisma } from '../lib/prisma'
import { defaultMethod, triageRequest } from './pipeline'
import { CATEGORY_LABELS, PRIORITY_FOR, type TriageMethod, type TriageOutcome, type WorkOrder } from './types'
import { draftWorkOrder } from './workorder'

export class MaintenanceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const AUTOMATION = 'maintenance_triage' as const
export const itemRef = (id: number) => `maintenance:${id}`
const json = (value: unknown) => value as Prisma.InputJsonValue

export const RELATIONS = {
  property: { select: { id: true, code: true, address: true, suburb: true, city: true } },
  contractor: { select: { id: true, name: true, trade: true, email: true } },
} as const

export interface TriageInput {
  actor: Actor
  propertyId: number
  tenantId?: number | null
  text: string
  photoNote?: string | null
  method?: TriageMethod
  receivedAt?: Date
  /** The sample id when loaded from the labelled set, so a reload replaces it. */
  sampleId?: string
}

/** Everything the work order draws on: the company's contractors and its completed jobs. */
async function companyContext(organisationId: number) {
  const [org, contractors, jobs] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { currency: true } }),
    prisma.contractor.findMany({ where: { organisationId }, orderBy: { id: 'asc' } }),
    prisma.maintenanceRequest.findMany({ where: { property: { organisationId } }, select: { contractorId: true, category: true, cost: true, quoteAmount: true, status: true } }),
  ])
  return { currency: org.currency, contractors, jobs }
}

/** Triages a tenant's request, stores it as a maintenance job with a draft work order, and records the run. */
export async function createFromRequest(input: TriageInput) {
  const property = await prisma.property.findFirst({ where: { id: input.propertyId, organisationId: input.actor.organisationId } })
  if (!property) throw new MaintenanceError(404, 'Property not found')
  const text = input.text.trim()
  if (text.length < 5) throw new MaintenanceError(400, 'Describe the problem in a sentence or two.')
  if (text.length > 5000) throw new MaintenanceError(400, 'The request is too long (5000 characters at most).')
  const tenant = input.tenantId
    ? await prisma.tenant.findFirst({ where: { id: input.tenantId, organisationId: input.actor.organisationId } })
    : await prisma.tenant.findFirst({ where: { organisationId: input.actor.organisationId, leases: { some: { propertyId: property.id, status: 'active' } } } })

  const triage: TriageOutcome = await triageRequest({ text, photoNote: input.photoNote ?? null }, input.method ?? defaultMethod())
  const ctx = await companyContext(input.actor.organisationId)
  const workOrder = draftWorkOrder({
    triage,
    property,
    tenant: tenant ? { name: `${tenant.firstName} ${tenant.lastName}`, phone: tenant.phone } : null,
    contractors: ctx.contractors,
    jobs: ctx.jobs,
    currency: ctx.currency,
    now: input.receivedAt,
  })
  const outcome = triage.model.error ? 'auto' : 'auto'
  const job = await prisma.maintenanceRequest.create({
    data: {
      propertyId: property.id,
      title: triage.summary,
      description: text + (input.photoNote ? `\n\nPhoto: ${input.photoNote.trim()}` : ''),
      priority: PRIORITY_FOR[triage.urgency],
      status: 'open',
      source: 'tenant_request',
      category: triage.category,
      photoNote: input.photoNote?.trim() || null,
      triageMethod: triage.method,
      triage: json({ ...triage, sampleId: input.sampleId ?? null, tenantId: tenant?.id ?? null }),
      workOrder: json(workOrder),
      ...(input.receivedAt ? { createdAt: input.receivedAt } : {}),
    },
    include: RELATIONS,
  })
  await recordRun({ actor: input.actor, automation: AUTOMATION, itemRef: itemRef(job.id), outcome, at: input.receivedAt })
  await audit({
    actor: input.actor,
    action: 'maintenance.triaged',
    entity: 'maintenance',
    entityId: job.id,
    after: {
      method: triage.method,
      category: triage.category,
      urgency: triage.urgency,
      safety: triage.safety,
      contractor: workOrder.contractor?.name ?? null,
      budget: workOrder.budget ? [workOrder.budget.low, workOrder.budget.high] : null,
    },
    note: `${triage.method} triaged "${triage.summary}" as ${CATEGORY_LABELS[triage.category].toLowerCase()}, ${triage.urgency}${triage.safety.length ? ` (safety: ${triage.safety.join(', ')})` : ''}; suggested ${workOrder.contractor?.name ?? 'no contractor'}.`,
    at: input.receivedAt,
  })
  return job
}

async function findOwn(organisationId: number, id: number) {
  const job = Number.isInteger(id) ? await prisma.maintenanceRequest.findFirst({ where: { id, property: { organisationId } }, include: RELATIONS }) : null
  if (!job) throw new MaintenanceError(404, 'Maintenance request not found')
  return job
}

const seconds = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 4 * 3600) : 0
}

export interface ApproveBody {
  contractorId?: unknown
  scope?: unknown
  accessNotes?: unknown
  budgetHigh?: unknown
  reviewSeconds?: unknown
}

/**
 * A person approves the work order, with any edits. The role's work-order limit applies to the budget ceiling.
 * Approval assigns the contractor and moves the job to in_progress; the contractor is not contacted by the app.
 */
export async function approveWorkOrder(actor: Actor, id: number, body: ApproveBody) {
  const job = await findOwn(actor.organisationId, id)
  const order = job.workOrder as unknown as WorkOrder | null
  if (!order) throw new MaintenanceError(409, 'This job has no draft work order.')
  if (order.status !== 'draft') throw new MaintenanceError(409, `This work order is already ${order.status}.`)

  const contractorId = body.contractorId === undefined || body.contractorId === null ? order.contractor?.id ?? null : Number(body.contractorId)
  const contractor = contractorId ? await prisma.contractor.findFirst({ where: { id: contractorId, organisationId: actor.organisationId } }) : null
  if (contractorId && !contractor) throw new MaintenanceError(400, 'Choose a contractor from this company.')
  const scope = typeof body.scope === 'string' && body.scope.trim() ? body.scope.trim().slice(0, 2000) : order.scope
  const accessNotes = typeof body.accessNotes === 'string' && body.accessNotes.trim() ? body.accessNotes.trim().slice(0, 1000) : order.accessNotes
  const budgetHigh = body.budgetHigh === undefined || body.budgetHigh === null || body.budgetHigh === '' ? order.budget?.high ?? null : Number(body.budgetHigh)
  if (budgetHigh !== null && !(Number.isFinite(budgetHigh) && budgetHigh >= 0)) throw new MaintenanceError(400, 'The budget must be a number.')
  assertCanApprove(actor, 'workOrder', budgetHigh)

  const changed: string[] = []
  if (contractorId !== (order.contractor?.id ?? null)) changed.push('contractor')
  if (scope !== order.scope) changed.push('scope')
  if (accessNotes !== order.accessNotes) changed.push('access notes')
  if (budgetHigh !== (order.budget?.high ?? null)) changed.push('budget')
  const reviewSeconds = seconds(body.reviewSeconds)
  const approved: WorkOrder = {
    ...order,
    scope,
    accessNotes,
    budget: order.budget ? { ...order.budget, high: budgetHigh ?? order.budget.high } : budgetHigh !== null ? { low: 0, high: budgetHigh, currency: '', basis: 'set by the approver', sampleSize: 0 } : null,
    contractor: contractor
      ? { ...(order.contractor && order.contractor.id === contractor.id ? order.contractor : { id: contractor.id, name: contractor.name, trade: contractor.trade, available: contractor.available, availableFrom: null, similarJobs: 0, typicalCost: null, score: 0, why: 'chosen by the approver' }) }
      : null,
    status: 'approved',
    approvedBy: { userId: actor.userId, at: new Date().toISOString() },
  }
  const updated = await prisma.maintenanceRequest.update({
    where: { id },
    data: {
      workOrder: json(approved),
      contractorId: contractor?.id ?? null,
      status: 'in_progress',
      quoteAmount: budgetHigh,
      approvedAt: new Date(),
      reviewSeconds: (job.reviewSeconds ?? 0) + reviewSeconds,
    },
    include: RELATIONS,
  })
  await recordReview(itemRef(id), reviewSeconds, changed.length ? 'corrected' : 'reviewed')
  await audit({
    actor,
    action: 'maintenance.work_order_approved',
    entity: 'maintenance',
    entityId: id,
    field: changed.length ? changed.join(', ') : null,
    before: changed.length ? { contractor: order.contractor?.name ?? null, budgetHigh: order.budget?.high ?? null, scope: order.scope, accessNotes: order.accessNotes } : undefined,
    after: changed.length ? { contractor: contractor?.name ?? null, budgetHigh, scope, accessNotes } : undefined,
    note: `Work order for "${job.title}" approved${changed.length ? ` with ${changed.join(', ')} changed` : ' as drafted'}; ${contractor ? contractor.name : 'no contractor'}${budgetHigh !== null ? `, budget up to ${budgetHigh}` : ''}.`,
  })
  return updated
}

export async function rejectWorkOrder(actor: Actor, id: number, body: { reason?: unknown; reviewSeconds?: unknown }) {
  const job = await findOwn(actor.organisationId, id)
  const order = job.workOrder as unknown as WorkOrder | null
  if (!order) throw new MaintenanceError(409, 'This job has no draft work order.')
  if (order.status !== 'draft') throw new MaintenanceError(409, `This work order is already ${order.status}.`)
  assertCanApprove(actor, 'workOrder', null)
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  const reviewSeconds = seconds(body.reviewSeconds)
  const updated = await prisma.maintenanceRequest.update({
    where: { id },
    data: { workOrder: json({ ...order, status: 'rejected' }), reviewSeconds: (job.reviewSeconds ?? 0) + reviewSeconds },
    include: RELATIONS,
  })
  await recordReview(itemRef(id), reviewSeconds, 'rejected')
  await audit({ actor, action: 'maintenance.work_order_rejected', entity: 'maintenance', entityId: id, note: reason ? `Work order for "${job.title}" rejected: ${reason}` : `Work order for "${job.title}" rejected by a person.` })
  return updated
}
