import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadDemo } from '../src/inbox/demo'
import { prisma } from '../src/lib/prisma'
import { app, demoAuth, hasDb } from './helpers'

// These tests use their own account (the webhook's `to` address routes messages to it), so the demo data that other
// tests rely on is left alone. AI_DRIVER=off in the test config, so the rules triage every message.
const SECRET = 'test-webhook-secret'
const OWNER = 'inbox-api-test@example.com'

describe.skipIf(!hasDb)('tenant inbox webhook and API', () => {
  let auth: { Authorization: string }
  let userId: number
  let propertyId: number
  const previousSecret = process.env.INBOX_WEBHOOK_SECRET

  const hook = (body: Record<string, unknown>, secret: string | null = SECRET) => {
    const req = request(app).post('/api/webhooks/inbox')
    return (secret === null ? req : req.set('x-webhook-secret', secret)).send({ to: OWNER, ...body })
  }

  beforeAll(async () => {
    process.env.INBOX_WEBHOOK_SECRET = SECRET
    await prisma.user.deleteMany({ where: { email: OWNER } })
    const reg = await request(app).post('/api/auth/register').send({ email: OWNER, password: 'test1234', name: 'Inbox Test' })
    auth = { Authorization: `Bearer ${reg.body.token}` }
    userId = reg.body.user.id
    const property = await prisma.property.create({
      data: { userId, code: 'TST4', address: '4 Harakeke Street', suburb: 'Grey Lynn', city: 'Auckland', bedrooms: 2, bathrooms: 1, rentPrice: 600, status: 'tenanted' },
    })
    propertyId = property.id
    const tenant = await prisma.tenant.create({ data: { userId, firstName: 'Ruby', lastName: 'Taylor', email: 'ruby.taylor@example.com', phone: '021 555 0190' } })
    await prisma.lease.create({ data: { propertyId, tenantId: tenant.id, startDate: new Date('2025-01-06'), weeklyRent: 600, bondAmount: 2400, rentReference: 'TAYLOR TST4' } })
  })

  afterAll(async () => {
    await prisma.automationRun.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { email: OWNER } })
    if (previousSecret === undefined) delete process.env.INBOX_WEBHOOK_SECRET
    else process.env.INBOX_WEBHOOK_SECRET = previousSecret
  })

  describe('webhook authentication', () => {
    it('rejects a missing or wrong secret', async () => {
      const body = { from: 'ruby.taylor@example.com', subject: 'Hi', text: 'Hello' }
      expect((await hook(body, null)).status).toBe(401)
      expect((await hook(body, 'wrong-secret')).status).toBe(401)
      expect(await prisma.inboxMessage.count({ where: { userId } })).toBe(0)
    })

    it('refuses every request while no secret is configured', async () => {
      delete process.env.INBOX_WEBHOOK_SECRET
      try {
        expect((await hook({ from: 'ruby.taylor@example.com', subject: 'Hi', text: 'Hello' })).status).toBe(503)
      } finally {
        process.env.INBOX_WEBHOOK_SECRET = SECRET
      }
    })

    it('does not accept a JWT instead of the secret, and validates the body', async () => {
      const jwtOnly = await request(app).post('/api/webhooks/inbox').set(auth).send({ to: OWNER, from: 'a@example.com', subject: 'x', text: 'y' })
      expect(jwtOnly.status).toBe(401)
      const invalid = await hook({ from: 'ruby.taylor@example.com', subject: 'No body' })
      expect(invalid.status).toBe(400)
    })
  })

  let firstId: number
  let ticketId: number

  describe('triage and idempotency', () => {
    it('stores, triages and returns the summary, creating an urgent maintenance job', async () => {
      const res = await hook({
        from: 'Ruby Taylor <ruby.taylor@example.com>',
        subject: 'Gas smell',
        text: 'There is a strong smell of gas in the kitchen near the hob. I have opened the windows.',
        messageId: 'msg-gas-1',
        receivedAt: '2026-09-28T09:00:00+13:00',
      })
      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({
        duplicate: false,
        status: 'triaged',
        method: 'rules',
        category: 'maintenance',
        urgency: 'urgent',
        needsPerson: true,
        tenant: { name: 'Ruby Taylor' },
        property: { code: 'TST4' },
        ticket: { action: 'created' },
        sent: false,
      })
      expect(res.body.citedClauses).toContain(8)
      firstId = res.body.id
      ticketId = res.body.ticket.id

      const job = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: ticketId } })
      expect(job).toMatchObject({ propertyId, source: 'inbox', priority: 'urgent', status: 'open' })
      const runs = await prisma.automationRun.findMany({ where: { itemRef: `inbox:${firstId}` } })
      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({ automation: 'inbox_triage', outcome: 'auto', userId })
    })

    it('returns the stored triage for a repeated messageId instead of storing it again', async () => {
      const res = await hook({ from: 'ruby.taylor@example.com', subject: 'Gas smell', text: 'Resent by the mail server.', messageId: 'msg-gas-1' })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id: firstId, duplicate: true })
      expect(await prisma.inboxMessage.count({ where: { userId, externalId: 'msg-gas-1' } })).toBe(1)
      expect(await prisma.automationRun.count({ where: { itemRef: `inbox:${firstId}` } })).toBe(1)
    })

    it('stores two deliveries of the same messageId arriving together only once', async () => {
      const body = { from: 'ruby.taylor@example.com', subject: 'Rent statement', text: 'Could you send my rent statement?', messageId: 'msg-race' }
      const [a, b] = await Promise.all([hook(body), hook(body)])
      expect([a.status, b.status].sort()).toEqual([200, 201])
      expect(a.body.id).toBe(b.body.id)
      expect(await prisma.inboxMessage.count({ where: { userId, externalId: 'msg-race' } })).toBe(1)
    })
  })

  describe('maintenance jobs', () => {
    it('links a second report of the same issue within 7 days to the existing job', async () => {
      const res = await hook({
        from: 'ruby.taylor@example.com',
        subject: 'Re: Gas smell',
        text: 'Still a smell of gas near the hob this morning. Is someone coming?',
        messageId: 'msg-gas-2',
        receivedAt: '2026-09-30T08:00:00+13:00',
      })
      expect(res.body.ticket).toMatchObject({ action: 'linked', id: ticketId })
      expect(await prisma.maintenanceRequest.count({ where: { propertyId, source: 'inbox' } })).toBe(1)
    })

    it('creates a separate job for a different issue', async () => {
      const res = await hook({ from: 'ruby.taylor@example.com', subject: 'Dripping tap', text: 'The bathroom tap drips constantly. Not urgent.', messageId: 'msg-tap', receivedAt: '2026-09-30T09:00:00+13:00' })
      expect(res.body.ticket.action).toBe('created')
      expect(res.body.ticket.id).not.toBe(ticketId)
    })

    it('creates a new job for the same issue once the earlier job is completed and more than 7 days old', async () => {
      await prisma.maintenanceRequest.update({ where: { id: ticketId }, data: { status: 'completed' } })
      const res = await hook({ from: 'ruby.taylor@example.com', subject: 'Gas smell again', text: 'The smell of gas is back near the hob.', messageId: 'msg-gas-3', receivedAt: '2026-10-08T09:00:00+13:00' })
      expect(res.body.ticket.action).toBe('created')
      expect(res.body.ticket.id).not.toBe(ticketId)
    })

    it('creates no job when the property is unknown', async () => {
      const res = await hook({ from: 'stranger@example.com', subject: 'Leak', text: 'There is a leak under our kitchen sink.', messageId: 'msg-unknown' })
      expect(res.body).toMatchObject({ category: 'maintenance', needsPerson: true, property: null, ticket: { action: 'no_property', id: null } })
    })
  })

  describe('owner of a webhook message', () => {
    it('attaches to the first account when `to` is not a user', async () => {
      const res = await request(app)
        .post('/api/webhooks/inbox')
        .set('x-webhook-secret', SECRET)
        .send({ from: 'someone@example.com', subject: 'Hello', text: 'Just saying hello.', messageId: 'msg-default-owner' })
      expect(res.status).toBe(201)
      const stored = await prisma.inboxMessage.findUniqueOrThrow({ where: { id: res.body.id } })
      const first = await prisma.user.findFirstOrThrow({ orderBy: { id: 'asc' } })
      expect(stored.userId).toBe(first.id)
      await prisma.automationRun.deleteMany({ where: { itemRef: `inbox:${stored.id}` } })
      await prisma.inboxMessage.delete({ where: { id: stored.id } })
    })
  })

  describe('inbox API', () => {
    it('requires a token', async () => {
      expect((await request(app).get('/api/inbox')).status).toBe(401)
    })

    it('lists messages with status and category filters', async () => {
      const all = await request(app).get('/api/inbox').set(auth)
      expect(all.status).toBe(200)
      expect(all.body.length).toBeGreaterThanOrEqual(6)
      const maintenance = await request(app).get('/api/inbox?status=open&category=maintenance').set(auth)
      expect(maintenance.body.length).toBeGreaterThan(0)
      expect(maintenance.body.every((m: { category: string; status: string }) => m.category === 'maintenance' && m.status === 'triaged')).toBe(true)
      expect((await request(app).get('/api/inbox?status=bogus').set(auth)).status).toBe(400)
      const meta = await request(app).get('/api/inbox/meta').set(auth)
      expect(meta.body).toMatchObject({ aiEnabled: false, webhookConfigured: true })
      expect(meta.body.counts.all).toBe(all.body.length)
    })

    it('returns a message with the full text of the cited clauses, only to its owner', async () => {
      const res = await request(app).get(`/api/inbox/${firstId}`).set(auth)
      expect(res.status).toBe(200)
      expect(res.body.clauses[0]).toMatchObject({ number: 8, title: 'Urgent repairs' })
      expect(res.body.clauses[0].text).toMatch(/smell gas, leave the house/)
      expect(res.body.triage.reasons.length).toBeGreaterThan(0)
      expect((await request(app).get(`/api/inbox/${firstId}`).set(await demoAuth())).status).toBe(404)
    })

    it('approves an edited reply without sending anything and records the correction', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const edited = 'Kia ora Ruby,\n\nPlease leave the house and call 111. We are calling you now (Tenancy terms §8).\n\nNgā mihi,\nAcme Property Management'
      const res = await request(app).post(`/api/inbox/${firstId}/approve`).set(auth).send({ replyDraft: edited, reviewSeconds: 42 })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ status: 'approved', replyDraft: edited, reviewSeconds: 42 })
      expect(res.body.approvedAt).toBeTruthy()
      expect(res.body.triage.review).toMatchObject({ outcome: 'corrected', changed: true })
      expect(res.body.triage.systemDraft).not.toBe(edited)
      expect(fetchSpy).not.toHaveBeenCalled()
      fetchSpy.mockRestore()

      const run = await prisma.automationRun.findFirstOrThrow({ where: { itemRef: `inbox:${firstId}` } })
      expect(run).toMatchObject({ outcome: 'corrected', reviewSeconds: 42 })
      expect(await prisma.inboxMessage.count({ where: { userId, status: 'sent' } })).toBe(0)
      expect((await request(app).post(`/api/inbox/${firstId}/approve`).set(auth).send({ replyDraft: edited, reviewSeconds: 5 })).status).toBe(409)
      expect((await request(app).post(`/api/inbox/${firstId}/retriage`).set(auth)).status).toBe(409)
    })

    it('records an unchanged approval as reviewed', async () => {
      const msg = await prisma.inboxMessage.findFirstOrThrow({ where: { userId, externalId: 'msg-tap' } })
      const res = await request(app).post(`/api/inbox/${msg.id}/approve`).set(auth).send({ replyDraft: `${msg.replyDraft}\n`, reviewSeconds: 12 })
      expect(res.body.triage.review.outcome).toBe('reviewed')
      expect((await prisma.automationRun.findFirstOrThrow({ where: { itemRef: `inbox:${msg.id}` } })).outcome).toBe('reviewed')
    })

    it('rejects an empty reply', async () => {
      const msg = await prisma.inboxMessage.findFirstOrThrow({ where: { userId, externalId: 'msg-unknown' } })
      expect((await request(app).post(`/api/inbox/${msg.id}/approve`).set(auth).send({ replyDraft: '  ', reviewSeconds: 3 })).status).toBe(400)
    })

    it('dismisses, then re-runs the triage without adding a run or a second job', async () => {
      const msg = await prisma.inboxMessage.findFirstOrThrow({ where: { userId, externalId: 'msg-gas-2' } })
      const dismissed = await request(app).post(`/api/inbox/${msg.id}/dismiss`).set(auth).send({ reviewSeconds: 9 })
      expect(dismissed.body.status).toBe('dismissed')
      const run = await prisma.automationRun.findFirstOrThrow({ where: { itemRef: `inbox:${msg.id}` } })
      expect(run).toMatchObject({ outcome: 'rejected', reviewSeconds: 9 })

      const jobsBefore = await prisma.maintenanceRequest.count({ where: { propertyId } })
      const again = await request(app).post(`/api/inbox/${msg.id}/retriage`).set(auth)
      expect(again.status).toBe(200)
      expect(again.body).toMatchObject({ status: 'triaged', maintenanceRequestId: msg.maintenanceRequestId })
      expect(await prisma.maintenanceRequest.count({ where: { propertyId } })).toBe(jobsBefore)
      expect(await prisma.automationRun.count({ where: { itemRef: `inbox:${msg.id}` } })).toBe(1)
    })
  })

  describe('demo loader', () => {
    it('pushes 15 sample emails through the pipeline once', async () => {
      const first = await loadDemo(userId)
      expect(first).toEqual({ loaded: 15, alreadyLoaded: 0, method: 'rules' })
      expect(await prisma.inboxMessage.count({ where: { userId, externalId: { startsWith: 'demo-' } } })).toBe(15)
      expect(await prisma.automationRun.count({ where: { userId, automation: 'inbox_triage', itemRef: { startsWith: 'inbox:' } } })).toBeGreaterThanOrEqual(15)
      expect(await loadDemo(userId)).toEqual({ loaded: 0, alreadyLoaded: 15, method: 'rules' })
    })
  })
})
