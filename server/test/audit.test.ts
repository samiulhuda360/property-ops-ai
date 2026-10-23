// The audit trail: every decision writes an event with who, when, before and after; the page filters and exports it.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { audit, auditCsv, listAudit } from '../src/lib/audit'
import { prisma } from '../src/lib/prisma'
import { app, authAs, hasDb } from './helpers'

describe.skipIf(!hasDb)('audit trail', () => {
  let manager: { Authorization: string }
  let accounts: { Authorization: string }
  let organisationId: number
  let userId: number

  beforeAll(async () => {
    manager = await authAs('demo@example.com')
    accounts = await authAs('james@acme.example.com')
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'james@acme.example.com' } })
    organisationId = user.organisationId
    userId = user.id
    await audit({ actor: { userId, organisationId }, action: 'document.approved', entity: 'document', entityId: 990001, field: 'total', before: 100, after: 120, note: 'audit test: total corrected', at: new Date('2026-08-15T10:00:00Z') })
    await audit({ actor: { userId, organisationId }, action: 'inbox.dismissed', entity: 'inbox', entityId: 990002, note: 'audit test: dismissed', at: new Date('2026-08-16T10:00:00Z') })
  })

  it('lists events newest first with the person, and filters by entity, action, user, date and text', async () => {
    const all = await request(app).get('/api/audit').set(manager)
    expect(all.status).toBe(200)
    const mine = all.body.filter((e: { note: string | null }) => e.note?.startsWith('audit test'))
    expect(mine.map((e: { action: string }) => e.action)).toEqual(['inbox.dismissed', 'document.approved'])
    expect(mine[1]).toMatchObject({ field: 'total', before: 100, after: 120, user: { name: 'James Hart', role: 'accounts' } })

    const byEntity = await request(app).get('/api/audit?entity=inbox&search=audit%20test').set(manager)
    expect(byEntity.body.map((e: { action: string }) => e.action)).toEqual(['inbox.dismissed'])
    const byAction = await request(app).get('/api/audit?action=document.&search=audit%20test').set(manager)
    expect(byAction.body).toHaveLength(1)
    const byUser = await request(app).get(`/api/audit?userId=${userId}&search=audit%20test`).set(manager)
    expect(byUser.body).toHaveLength(2)
    const byDate = await request(app).get('/api/audit?from=2026-08-16&to=2026-08-16&search=audit%20test').set(manager)
    expect(byDate.body.map((e: { action: string }) => e.action)).toEqual(['inbox.dismissed'])
    expect((await request(app).get('/api/audit?entity=spaceship').set(manager)).status).toBe(400)
  })

  it('offers the filter options and a CSV export', async () => {
    const meta = await request(app).get('/api/audit/meta').set(accounts)
    expect(meta.status).toBe(200)
    expect(meta.body.users.map((u: { name: string }) => u.name)).toContain('Emma Walker')
    expect(meta.body.actions['lease.field_corrected']).toBeTruthy()
    const csv = await request(app).get('/api/audit/export.csv?search=audit%20test').set(accounts)
    expect(csv.status).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    const lines = csv.text.trim().split('\n')
    expect(lines[0]).toBe('when,who,role,action,entity,entity_id,field,before,after,note')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('James Hart,accounts,document.approved,document,990001,total,100,120,audit test: total corrected')
  })

  it('quotes commas and quotes in the CSV', async () => {
    const events = await listAudit(organisationId, { search: 'audit test', limit: 10 })
    const out = auditCsv([{ ...events[0], note: 'a "quoted", note', before: { x: 1 } }])
    expect(out).toContain('"{""x"":1}"')
    expect(out).toContain('"a ""quoted"", note"')
  })

  it('writes an event for every decision a person makes on an email', async () => {
    const list = await request(app).get('/api/inbox?status=triaged').set(manager)
    const msg = list.body[0]
    if (!msg) return
    const res = await request(app).post(`/api/inbox/${msg.id}/dismiss`).set(manager).send({ reviewSeconds: 5 })
    expect(res.status).toBe(200)
    const trail = await request(app).get('/api/audit?entity=inbox').set(manager)
    const event = trail.body.find((e: { entityId: number; action: string }) => e.entityId === msg.id && e.action === 'inbox.dismissed')
    expect(event).toBeTruthy()
    expect(event.user.name).toBe('Emma Walker')
  })
})
