import { Router, Response } from 'express'
import { AUDIT_ACTIONS, auditCsv, listAudit, type AuditFilter } from '../lib/audit'
import { prisma } from '../lib/prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

// The audit trail for the signed-in company: every AI extraction, approval, correction and decision, who and when,
// with the value before and after. Read-only, so every role may see it.
const router = Router()
router.use(authenticate)

const ENTITIES = ['lease', 'document', 'inbox', 'bank', 'risk', 'maintenance', 'user']
const DAY = /^\d{4}-\d{2}-\d{2}$/

function filterFrom(req: AuthRequest): AuditFilter | string {
  const q = req.query
  const entity = typeof q.entity === 'string' && q.entity ? q.entity : undefined
  if (entity && !ENTITIES.includes(entity)) return `entity must be one of ${ENTITIES.join(', ')}`
  const action = typeof q.action === 'string' && q.action ? q.action : undefined
  const userId = typeof q.userId === 'string' && /^\d+$/.test(q.userId) ? Number(q.userId) : undefined
  const from = typeof q.from === 'string' && DAY.test(q.from) ? new Date(`${q.from}T00:00:00Z`) : undefined
  const to = typeof q.to === 'string' && DAY.test(q.to) ? new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) : undefined
  const search = typeof q.search === 'string' && q.search.trim() ? q.search.trim().slice(0, 100) : undefined
  const limit = typeof q.limit === 'string' && /^\d+$/.test(q.limit) ? Number(q.limit) : undefined
  return { entity, action, userId, from, to, search, limit }
}

/** The filter options: users of the company, entities, action labels. */
router.get('/meta', async (req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({ where: { organisationId: req.actor!.organisationId }, select: { id: true, name: true, role: true }, orderBy: { id: 'asc' } })
  const total = await prisma.auditEvent.count({ where: { organisationId: req.actor!.organisationId } })
  res.json({ users, entities: ENTITIES, actions: AUDIT_ACTIONS, total })
})

/** GET /api/audit?entity=&action=&userId=&from=&to=&search=&limit= */
router.get('/', async (req: AuthRequest, res: Response) => {
  const filter = filterFrom(req)
  if (typeof filter === 'string') {
    res.status(400).json({ error: filter })
    return
  }
  res.json(await listAudit(req.actor!.organisationId, filter))
})

/** The same rows as CSV, for an auditor or a spreadsheet. */
router.get('/export.csv', async (req: AuthRequest, res: Response) => {
  const filter = filterFrom(req)
  if (typeof filter === 'string') {
    res.status(400).json({ error: filter })
    return
  }
  const events = await listAudit(req.actor!.organisationId, { ...filter, limit: filter.limit ?? 5000 })
  res.setHeader('content-type', 'text/csv; charset=utf-8')
  res.setHeader('content-disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(auditCsv(events))
})

export default router
