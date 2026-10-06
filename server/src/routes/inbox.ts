import { Router, Response } from 'express'
import { z } from 'zod'
import { aiConfig, aiEnabled } from '../ai/llm'
import { loadDemo } from '../inbox/demo'
import { approveMessage, dismissMessage, findMessage, listMessages, retriageMessage, type ReviewResult, type TriageDetails } from '../inbox/pipeline'
import { getClause } from '../inbox/terms'
import { CATEGORIES } from '../inbox/types'
import { prisma } from '../lib/prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

// The tenant inbox for the signed-in manager. Approving stores the reply as approved: nothing is ever emailed.
const router = Router()

router.use(authenticate)

const STATUSES = ['new', 'triaged', 'approved', 'sent', 'dismissed'] as const
const STATUS_GROUPS: Record<string, string[]> = { open: ['new', 'triaged'], all: [] }

function parseStatuses(raw: unknown): string[] | null {
  if (raw === undefined || raw === '') return []
  if (typeof raw !== 'string') return null
  const out: string[] = []
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part in STATUS_GROUPS) out.push(...STATUS_GROUPS[part])
    else if ((STATUSES as readonly string[]).includes(part)) out.push(part)
    else return null
  }
  return out
}

const parseId = (raw: string) => (/^\d+$/.test(raw) ? Number(raw) : null)

function sendReview(res: Response, result: ReviewResult) {
  if (!result.ok) {
    res.status(result.status).json({ error: result.error })
    return
  }
  res.json(result.message)
}

/** Mode and counts for the page header. */
router.get('/meta', async (req: AuthRequest, res: Response) => {
  try {
    const grouped = await prisma.inboxMessage.groupBy({ by: ['status'], where: { userId: req.userId }, _count: { _all: true } })
    const count = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0
    res.json({
      aiEnabled: aiEnabled(),
      model: aiEnabled() ? aiConfig().model : null,
      webhookConfigured: Boolean(process.env.INBOX_WEBHOOK_SECRET),
      counts: {
        open: count('new') + count('triaged'),
        approved: count('approved'),
        dismissed: count('dismissed'),
        all: grouped.reduce((sum, g) => sum + g._count._all, 0),
      },
    })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

/** Loads 15 sample emails through the webhook pipeline (safe to repeat). */
router.post('/demo', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await loadDemo(req.userId!))
  } catch (e) {
    console.error('Inbox demo load failed:', e instanceof Error ? e.message : e)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/', async (req: AuthRequest, res: Response) => {
  const statuses = parseStatuses(req.query.status)
  if (statuses === null) {
    res.status(400).json({ error: `status must be one of ${[...Object.keys(STATUS_GROUPS), ...STATUSES].join(', ')}` })
    return
  }
  const category = typeof req.query.category === 'string' && req.query.category !== 'all' ? req.query.category : undefined
  if (category && !(CATEGORIES as readonly string[]).includes(category)) {
    res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` })
    return
  }
  try {
    res.json(await listMessages(req.userId!, { statuses, category }))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(404).json({ error: 'Message not found' })
    return
  }
  try {
    const message = await findMessage(req.userId!, id)
    if (!message) {
      res.status(404).json({ error: 'Message not found' })
      return
    }
    const triage = (message.triage as unknown as TriageDetails | null) ?? null
    const cited = triage?.citedClauses ?? (message.citedClause ? message.citedClause.split(',').map(Number) : [])
    const clauses = cited.map(getClause).filter((c): c is NonNullable<typeof c> => c !== null)
    res.json({ ...message, clauses })
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

const ApproveBody = z.object({
  replyDraft: z.string().trim().min(1, 'The reply is empty').max(10_000),
  reviewSeconds: z.number().finite().min(0).optional().default(0),
})

/** Approves the reply. It is stored as approved for a person to send; nothing is emailed. */
router.post('/:id/approve', async (req: AuthRequest, res: Response) => {
  const id = parseId(req.params.id)
  const parsed = ApproveBody.safeParse(req.body)
  if (id === null) {
    res.status(404).json({ error: 'Message not found' })
    return
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') })
    return
  }
  try {
    sendReview(res, await approveMessage(req.userId!, id, parsed.data.replyDraft, parsed.data.reviewSeconds))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

const DismissBody = z.object({ reviewSeconds: z.number().finite().min(0).optional().default(0) })

router.post('/:id/dismiss', async (req: AuthRequest, res: Response) => {
  const id = parseId(req.params.id)
  const parsed = DismissBody.safeParse(req.body ?? {})
  if (id === null) {
    res.status(404).json({ error: 'Message not found' })
    return
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') })
    return
  }
  try {
    sendReview(res, await dismissMessage(req.userId!, id, parsed.data.reviewSeconds))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/:id/retriage', async (req: AuthRequest, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(404).json({ error: 'Message not found' })
    return
  }
  try {
    sendReview(res, await retriageMessage(req.userId!, id))
  } catch {
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
