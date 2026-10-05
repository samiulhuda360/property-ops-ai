import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()

router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const requests = await prisma.maintenanceRequest.findMany({
      where: { property: { userId: req.userId } },
      include: { property: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(requests)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { propertyId, title, description, priority } = req.body
    const property = await prisma.property.findFirst({ where: { id: Number(propertyId), userId: req.userId } })
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
      where: { id: Number(req.params.id), property: { userId: req.userId } },
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
      where: { id: Number(req.params.id), property: { userId: req.userId } },
    })
    if (!request) { res.status(404).json({ error: 'Not found' }); return }
    await prisma.maintenanceRequest.delete({ where: { id: Number(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
