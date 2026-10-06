import { createHash, timingSafeEqual } from 'node:crypto'
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { ingestEmail, resolveOwner, type InboxMessageWithLinks, type TriageDetails } from '../inbox/pipeline'

// Webhooks from outside services. No JWT: each webhook checks its own shared secret.
const router = Router()

/** Compares secrets in constant time (hashing first makes the lengths equal). */
function secretMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

const InboxWebhookBody = z.object({
  from: z.string().trim().min(3).max(320),
  subject: z.string().max(500).default(''),
  text: z.string().min(1).max(20_000),
  messageId: z.string().trim().min(1).max(500).optional(),
  receivedAt: z
    .string()
    .optional()
    .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), 'receivedAt must be an ISO date'),
  to: z.string().trim().max(320).optional(),
})

/** The triage summary the webhook returns. */
export function triageSummary(m: InboxMessageWithLinks, duplicate: boolean) {
  const t = (m.triage as unknown as TriageDetails | null) ?? null
  return {
    id: m.id,
    duplicate,
    status: m.status,
    method: m.method,
    category: m.category,
    urgency: m.urgency,
    needsPerson: m.needsPerson,
    reasons: t?.reasons ?? (m.reason ? [m.reason] : []),
    summary: t?.summary ?? null,
    tenant: m.tenant ? { id: m.tenant.id, name: `${m.tenant.firstName} ${m.tenant.lastName}` } : null,
    property: m.property ? { id: m.property.id, code: m.property.code, address: m.property.address } : null,
    ticket: t?.ticket ?? null,
    citedClauses: t?.citedClauses ?? [],
    sent: false,
    note: 'Triaged and waiting for a person. Nothing has been sent to the sender.',
  }
}

/**
 * POST /api/webhooks/inbox: one incoming email.
 * Header x-webhook-secret must equal INBOX_WEBHOOK_SECRET. Body: { from, subject, text, messageId?, receivedAt?, to? }.
 * The message joins the account whose login email is `to`, otherwise the first account (the demo manager).
 * A messageId that was already received returns the stored triage (200) instead of storing it again (201).
 */
router.post('/inbox', async (req: Request, res: Response) => {
  const secret = process.env.INBOX_WEBHOOK_SECRET
  if (!secret) {
    res.status(503).json({ error: 'The inbox webhook is not configured: set INBOX_WEBHOOK_SECRET on the server.' })
    return
  }
  const given = req.header('x-webhook-secret')
  if (!given || !secretMatches(given, secret)) {
    res.status(401).json({ error: 'Missing or wrong x-webhook-secret header' })
    return
  }

  const parsed = InboxWebhookBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid email payload', issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) })
    return
  }
  const body = parsed.data

  try {
    const owner = await resolveOwner(body.to)
    if (owner === null) {
      res.status(409).json({ error: 'There is no account to attach the message to.' })
      return
    }
    const result = await ingestEmail(owner, {
      from: body.from,
      subject: body.subject,
      text: body.text,
      messageId: body.messageId,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : null,
    })
    res.status(result.duplicate ? 200 : 201).json(triageSummary(result.message, result.duplicate))
  } catch (e) {
    console.error('Inbox webhook failed:', e instanceof Error ? e.message : e)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
