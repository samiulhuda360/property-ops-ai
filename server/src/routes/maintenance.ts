import { Router, Response } from 'express'
import { aiConfig, aiEnabled } from '../ai/llm'
import { PermissionError } from '../lib/actor'
import { prisma } from '../lib/prisma'
import { loadRequests } from '../maintenance/demo'
import { defaultMethod } from '../maintenance/pipeline'
import { approveWorkOrder, createFromRequest, MaintenanceError, rejectWorkOrder, RELATIONS } from '../maintenance/service'
import { CATEGORIES, CATEGORY_LABELS, SAFETY_LABELS } from '../maintenance/types'
import { authenticate, requireWrite, AuthRequest } from '../middleware/auth'

const router = Router()

router.use(authenticate)
router.use(requireWrite)

function fail(res: Response, e: unknown) {
  if (e instanceof MaintenanceError || e instanceof PermissionError) {
    res.status(e.status).json({ error: e.message })
    return
  }
  console.error(e)
  res.status(500).json({ error: 'Server error' })
}

/** How requests are triaged right now, and the labels for the client. */
router.get('/method', (_req: AuthRequest, res: Response) => {
  res.json({
    method: defaultMethod(),
    aiEnabled: aiEnabled(),
    model: aiEnabled() ? aiConfig().model : null,
    categories: CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
    safety: SAFETY_LABELS,
  })
})

/** The labelled sample requests for this company, for "pick a sample". */
router.get('/samples', async (req: AuthRequest, res: Response) => {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: req.actor!.organisationId }, select: { slug: true } })
  res.json(loadRequests().filter((r) => r.company === org.slug).map(({ labels: _labels, ...r }) => r))
})

/** Triages a tenant's request: body { propertyId, text, photoNote?, tenantId? }. Creates the job with a draft work order. */
router.post('/triage', async (req: AuthRequest, res: Response) => {
  try {
    const { propertyId, text, photoNote, tenantId } = req.body ?? {}
    if (!Number.isInteger(Number(propertyId)) || typeof text !== 'string') {
      res.status(400).json({ error: 'Send propertyId and the request text.' })
      return
    }
    const job = await createFromRequest({
      actor: req.actor!,
      propertyId: Number(propertyId),
      tenantId: tenantId ? Number(tenantId) : null,
      text,
      photoNote: typeof photoNote === 'string' ? photoNote : null,
    })
    res.status(201).json(job)
  } catch (e) {
    fail(res, e)
  }
})

/** Triages one of the sample requests as if the tenant had just sent it. */
router.post('/samples/:id', async (req: AuthRequest, res: Response) => {
  try {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: req.actor!.organisationId }, select: { slug: true } })
    const sample = loadRequests().find((r) => r.id === req.params.id && r.company === org.slug)
    const property = sample ? await prisma.property.findFirst({ where: { organisationId: req.actor!.organisationId, code: sample.code } }) : null
    if (!sample || !property) {
      res.status(404).json({ error: 'Sample not found' })
      return
    }
    const job = await createFromRequest({ actor: req.actor!, propertyId: property.id, text: sample.text, photoNote: sample.photoNote })
    res.status(201).json(job)
  } catch (e) {
    fail(res, e)
  }
})

/** Body: { contractorId?, scope?, accessNotes?, budgetHigh?, reviewSeconds }. Assigns the contractor; nothing is sent. */
router.post('/:id/work-order/approve', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await approveWorkOrder(req.actor!, Number(req.params.id), req.body ?? {}))
  } catch (e) {
    fail(res, e)
  }
})

router.post('/:id/work-order/reject', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await rejectWorkOrder(req.actor!, Number(req.params.id), req.body ?? {}))
  } catch (e) {
    fail(res, e)
  }
})

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const requests = await prisma.maintenanceRequest.findMany({
      where: { property: { organisationId: req.actor!.organisationId } },
      include: RELATIONS,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    res.json(requests)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { propertyId, title, description, priority } = req.body
    const property = await prisma.property.findFirst({ where: { id: Number(propertyId), organisationId: req.actor!.organisationId } })
    if (!property) { res.status(404).json({ error: 'Property not found' }); return }
    const request = await prisma.maintenanceRequest.create({
      data: {
        propertyId: Number(propertyId),
        title,
        description,
        priority: priority || 'medium',
        status: 'open',
      },
      include: { property: true },
    })
    res.status(201).json(request)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const request = await prisma.maintenanceRequest.findFirst({
      where: { id: Number(req.params.id), property: { organisationId: req.actor!.organisationId } },
    })
    if (!request) { res.status(404).json({ error: 'Not found' }); return }
    const { title, description, priority, status, cost } = req.body
    const updated = await prisma.maintenanceRequest.update({
      where: { id: Number(req.params.id) },
      data: {
        title,
        description,
        priority,
        status,
        cost: cost ? Number(cost) : null,
        completedAt: status === 'completed' ? new Date() : null,
      },
      include: { property: true },
    })
    res.json(updated)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const request = await prisma.maintenanceRequest.findFirst({
      where: { id: Number(req.params.id), property: { organisationId: req.actor!.organisationId } },
    })
    if (!request) { res.status(404).json({ error: 'Not found' }); return }
    await prisma.maintenanceRequest.delete({ where: { id: Number(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
