import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()

router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const properties = await prisma.property.findMany({
      where: { userId: req.userId },
      include: {
        leases: { where: { status: 'active' }, include: { tenant: true } },
        _count: { select: { maintenance: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(properties)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const property = await prisma.property.findFirst({
      where: { id: Number(req.params.id), userId: req.userId },
      include: {
        leases: { include: { tenant: true, payments: { orderBy: { dueDate: 'desc' }, take: 5 } } },
        maintenance: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!property) { res.status(404).json({ error: 'Not found' }); return }
    res.json(property)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { address, suburb, city, bedrooms, bathrooms, rentPrice, status, description } = req.body
    const property = await prisma.property.create({
      data: { address, suburb, city, bedrooms: Number(bedrooms), bathrooms: Number(bathrooms), rentPrice: Number(rentPrice), status: status || 'vacant', description, userId: req.userId! },
    })
    res.status(201).json(property)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.property.findFirst({ where: { id: Number(req.params.id), userId: req.userId } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    const { address, suburb, city, bedrooms, bathrooms, rentPrice, status, description } = req.body
    const property = await prisma.property.update({
      where: { id: Number(req.params.id) },
      data: { address, suburb, city, bedrooms: Number(bedrooms), bathrooms: Number(bathrooms), rentPrice: Number(rentPrice), status, description },
    })
    res.json(property)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.property.findFirst({ where: { id: Number(req.params.id), userId: req.userId } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    await prisma.property.delete({ where: { id: Number(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
