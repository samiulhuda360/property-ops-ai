import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate, requireWrite, AuthRequest } from '../middleware/auth'

const router = Router()

router.use(authenticate)
router.use(requireWrite)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const leases = await prisma.lease.findMany({
      where: { property: { organisationId: req.actor!.organisationId } },
      include: { property: true, tenant: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(leases)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { propertyId, tenantId, startDate, endDate, weeklyRent, bondAmount, notes } = req.body

    const property = await prisma.property.findFirst({ where: { id: Number(propertyId), organisationId: req.actor!.organisationId } })
    if (!property) { res.status(404).json({ error: 'Property not found' }); return }

    const lease = await prisma.lease.create({
      data: {
        propertyId: Number(propertyId),
        tenantId: Number(tenantId),
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        weeklyRent: Number(weeklyRent),
        bondAmount: Number(bondAmount),
        notes,
        status: 'active',
      },
      include: { property: true, tenant: true },
    })

    await prisma.property.update({ where: { id: Number(propertyId) }, data: { status: 'tenanted' } })

    res.status(201).json(lease)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const lease = await prisma.lease.findFirst({
      where: { id: Number(req.params.id), property: { organisationId: req.actor!.organisationId } },
    })
    if (!lease) { res.status(404).json({ error: 'Not found' }); return }
    const { startDate, endDate, weeklyRent, bondAmount, status, notes } = req.body
    const updated = await prisma.lease.update({
      where: { id: Number(req.params.id) },
      data: {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : null,
        weeklyRent: weeklyRent ? Number(weeklyRent) : undefined,
        bondAmount: bondAmount ? Number(bondAmount) : undefined,
        status,
        notes,
      },
      include: { property: true, tenant: true },
    })
    if (status === 'ended') {
      await prisma.property.update({ where: { id: lease.propertyId }, data: { status: 'vacant' } })
    }
    res.json(updated)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const lease = await prisma.lease.findFirst({
      where: { id: Number(req.params.id), property: { organisationId: req.actor!.organisationId } },
    })
    if (!lease) { res.status(404).json({ error: 'Not found' }); return }
    await prisma.lease.delete({ where: { id: Number(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
