import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response) => {
  const contractors = await prisma.contractor.findMany({
    where: { userId: req.userId },
    orderBy: { name: 'asc' },
  })
  res.json(contractors)
})

export default router
