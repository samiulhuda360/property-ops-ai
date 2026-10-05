import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()

router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { userId: req.userId },
      include: {
        leases: {
          where: { status: 'active' },
          include: { property: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(tenants)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { id: Number(req.params.id), userId: req.userId },
      include: { leases: { include: { property: true, payments: { orderBy: { dueDate: 'desc' } } } } },
    })
    if (!tenant) { res.status(404).json({ error: 'Not found' }); return }
    res.json(tenant)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, email, phone } = req.body
    const tenant = await prisma.tenant.create({
      data: { firstName, lastName, email, phone, userId: req.userId! },
    })
    res.status(201).json(tenant)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.tenant.findFirst({ where: { id: Number(req.params.id), userId: req.userId } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    const { firstName, lastName, email, phone } = req.body
    const tenant = await prisma.tenant.update({
      where: { id: Number(req.params.id) },
      data: { firstName, lastName, email, phone },
    })
    res.json(tenant)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.tenant.findFirst({ where: { id: Number(req.params.id), userId: req.userId } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    await prisma.tenant.delete({ where: { id: Number(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
