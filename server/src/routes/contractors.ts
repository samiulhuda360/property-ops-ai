import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate, requireWrite, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.use(requireWrite)

router.get('/', async (req: AuthRequest, res: Response) => {
  const contractors = await prisma.contractor.findMany({
    where: { organisationId: req.actor!.organisationId },
    orderBy: { name: 'asc' },
  })
  res.json(contractors)
})

export default router
