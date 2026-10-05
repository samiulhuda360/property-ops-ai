import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()

router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { lease: { property: { userId: req.userId } } },
      include: { lease: { include: { property: true, tenant: true } } },
      orderBy: { dueDate: 'desc' },
    })
    res.json(payments)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { leaseId, amount, dueDate, paidDate, status, notes } = req.body
    const lease = await prisma.lease.findFirst({
      where: { id: Number(leaseId), property: { userId: req.userId } },
    })
    if (!lease) { res.status(404).json({ error: 'Lease not found' }); return }
    const payment = await prisma.payment.create({
      data: {
        leaseId: Number(leaseId),
        amount: Number(amount),
        dueDate: new Date(dueDate),
        paidDate: paidDate ? new Date(paidDate) : null,
        status: status || 'pending',
        notes,
      },
      include: { lease: { include: { property: true, tenant: true } } },
    })
    res.status(201).json(payment)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: Number(req.params.id), lease: { property: { userId: req.userId } } },
    })
    if (!payment) { res.status(404).json({ error: 'Not found' }); return }
    const { amount, dueDate, paidDate, status, notes } = req.body
    const updated = await prisma.payment.update({
      where: { id: Number(req.params.id) },
      data: {
        amount: amount ? Number(amount) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        paidDate: paidDate ? new Date(paidDate) : null,
        status,
        notes,
      },
      include: { lease: { include: { property: true, tenant: true } } },
    })
    res.json(updated)
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: Number(req.params.id), lease: { property: { userId: req.userId } } },
    })
    if (!payment) { res.status(404).json({ error: 'Not found' }); return }
    await prisma.payment.delete({ where: { id: Number(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
