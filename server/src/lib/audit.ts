// The audit trail: who did what, when, with the value before and after. Every AI extraction, approval, correction
// and decision across the automations writes one event here, and the Audit page reads them.
import type { Prisma } from '@prisma/client'
import type { Actor } from './actor'
import { prisma } from './prisma'

export type AuditEntity = 'lease' | 'document' | 'inbox' | 'bank' | 'risk' | 'maintenance' | 'user'

export interface AuditInput {
  actor: Pick<Actor, 'userId' | 'organisationId'>
  action: string
  entity?: AuditEntity
  entityId?: number | null
  leaseAbstractId?: number | null
  field?: string | null
  before?: unknown
  after?: unknown
  note?: string | null
  at?: Date
}

const json = (value: unknown) => value as Prisma.InputJsonValue

export async function audit(input: AuditInput) {
  return prisma.auditEvent.create({
    data: {
      userId: input.actor.userId,
      organisationId: input.actor.organisationId,
      leaseAbstractId: input.leaseAbstractId ?? (input.entity === 'lease' ? input.entityId ?? null : null),
      entity: input.entity ?? (input.leaseAbstractId ? 'lease' : null),
      entityId: input.entityId ?? input.leaseAbstractId ?? null,
      action: input.action,
      field: input.field ?? null,
      before: input.before === undefined ? undefined : json(input.before),
      after: input.after === undefined ? undefined : json(input.after),
      note: input.note ?? null,
      ...(input.at ? { createdAt: input.at } : {}),
    },
  })
}

export const AUDIT_ACTIONS: Record<string, string> = {
  'lease.extracted': 'Lease read by the automation',
  'lease.field_approved': 'Lease term approved',
  'lease.field_corrected': 'Lease term corrected',
  'lease.risk_reviewed': 'Lease risk decided',
  'lease.approved': 'Lease approved',
  'lease.rejected': 'Lease rejected',
  'document.extracted': 'Document read by the automation',
  'document.approved': 'Document approved',
  'document.rejected': 'Document rejected',
  'document.exported': 'Document sent to accounting',
  'inbox.triaged': 'Email triaged by the automation',
  'inbox.approved': 'Reply approved',
  'inbox.dismissed': 'Email dismissed',
  'bank.imported': 'Bank statement imported',
  'bank.resolved': 'Bank line decided',
  'risk.scored': 'Arrears risk scored',
  'risk.approved': 'Risk next step approved',
  'risk.dismissed': 'Risk next step dismissed',
  'maintenance.triaged': 'Maintenance request triaged',
  'maintenance.work_order_approved': 'Work order approved',
  'maintenance.work_order_rejected': 'Work order rejected',
  'user.role_changed': 'User role changed',
}

export interface AuditFilter {
  entity?: string
  action?: string
  userId?: number
  from?: Date
  to?: Date
  search?: string
  limit?: number
}

export async function listAudit(organisationId: number, f: AuditFilter) {
  return prisma.auditEvent.findMany({
    where: {
      organisationId,
      ...(f.entity ? { entity: f.entity } : {}),
      ...(f.action ? { action: { startsWith: f.action } } : {}),
      ...(f.userId ? { userId: f.userId } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
      ...(f.search ? { OR: [{ note: { contains: f.search, mode: 'insensitive' } }, { field: { contains: f.search, mode: 'insensitive' } }] } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(f.limit ?? 500, 1), 5000),
  })
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function auditCsv(events: Awaited<ReturnType<typeof listAudit>>): string {
  const lines = ['when,who,role,action,entity,entity_id,field,before,after,note']
  for (const e of events) {
    lines.push(
      [e.createdAt.toISOString(), e.user.name, e.user.role, e.action, e.entity ?? '', e.entityId ?? '', e.field ?? '', e.before, e.after, e.note ?? '']
        .map(cell)
        .join(','),
    )
  }
  return lines.join('\n') + '\n'
}
