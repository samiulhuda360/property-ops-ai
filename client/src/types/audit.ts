export interface AuditEvent {
  id: number
  userId: number
  entity: string | null
  entityId: number | null
  leaseAbstractId: number | null
  action: string
  field: string | null
  before: unknown
  after: unknown
  note: string | null
  createdAt: string
  user: { id: number; name: string; email: string; role: string }
}

export interface AuditMeta {
  users: { id: number; name: string; role: string }[]
  entities: string[]
  actions: Record<string, string>
  total: number
}

export interface AuditFilter {
  entity?: string
  action?: string
  userId?: number
  from?: string
  to?: string
  search?: string
}
