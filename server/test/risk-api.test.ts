// The Risk tab's API on a fresh database: load the roster and history for Acme, score, review a next step.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { actorFor } from '../src/lib/actor'
import { prisma } from '../src/lib/prisma'
import { loadDemo, loadHistory } from '../src/risk/demo'
import { app, authAs, demoAuth, hasDb } from './helpers'

describe.skipIf(!hasDb)('arrears risk API', () => {
  let auth: { Authorization: string }
  let highId: number

  beforeAll(async () => {
    auth = await demoAuth()
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@example.com' } })
    const result = await loadDemo(actorFor(user))
    expect(result.tenancies).toBe(30)
    expect(result.scored).toBe(30)
    expect(result.asOf).toBe('2026-09')
  })

  it('describes the model behind the scores', async () => {
    const res = await request(app).get('/api/risk/model').set(auth)
    expect(res.status).toBe(200)
    expect(res.body.version).toBe('arrears-lr-v1')
    expect(res.body.features).toHaveLength(10)
  })

  it('lists every tenancy with a band, three reasons at most and a draft next step, highest risk first', async () => {
    const res = await request(app).get('/api/risk').set(auth)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(30)
    for (let i = 1; i < res.body.length; i++) expect(res.body[i - 1].probability).toBeGreaterThanOrEqual(res.body[i].probability)
    const top = res.body[0]
    expect(top.band).toBe('high')
    expect(top.reasons.length).toBeGreaterThan(0)
    expect(top.reasons.length).toBeLessThanOrEqual(3)
    expect(top.draft.length).toBeGreaterThan(20)
    expect(top.tenant.firstName).toBeTruthy()
    expect(top.lease.property.code).toBeTruthy()
    highId = top.id
    const onlyHigh = await request(app).get('/api/risk?band=high').set(auth)
    expect(onlyHigh.body.every((r: { band: string }) => r.band === 'high')).toBe(true)
    // The truth from the generator agrees with the bands on the demo scoring point for the chronic cases.
    const history = loadHistory()
    const truthHigh = res.body.filter((r: { band: string; lease: { property: { code: string } } }) => r.band === 'high' && history.truth[`acme-${r.lease.property.code}`])
    expect(truthHigh.length).toBeGreaterThan(0)
  })

  it('shows the month-by-month history behind a score', async () => {
    const res = await request(app).get(`/api/risk/${highId}`).set(auth)
    expect(res.status).toBe(200)
    expect(res.body.history.length).toBeGreaterThan(5)
    expect(res.body.history[0]).toHaveProperty('daysLate')
    expect((await request(app).get('/api/risk/999999').set(auth)).status).toBe(404)
  })

  it('lets a person approve the next step after editing it, and records review time and the audit event', async () => {
    const edited = 'Hi there, could we have a quick chat about the rent this week?'
    const res = await request(app).post(`/api/risk/${highId}/review`).set(auth).send({ decision: 'approve', draft: edited, reviewSeconds: 45 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'approved', draft: edited, reviewSeconds: 45 })
    const again = await request(app).post(`/api/risk/${highId}/review`).set(auth).send({ decision: 'approve' })
    expect(again.status).toBe(409)
    const run = await prisma.automationRun.findFirst({ where: { itemRef: `risk:${highId}` }, orderBy: { id: 'desc' } })
    expect(run).toMatchObject({ automation: 'risk_review', outcome: 'corrected', reviewSeconds: 45, baselineMinutes: 8 })
    const audit = await request(app).get(`/api/audit?entity=risk&action=risk.approved`).set(auth)
    const event = audit.body.find((e: { entityId: number }) => e.entityId === highId)
    expect(event.after.draft).toBe(edited)
    expect(event.before.draft).not.toBe(edited)
  })

  it('keeps an approved decision when a rescore gives the same band and step, and refuses a read-only reviewer', async () => {
    const rescored = await request(app).post('/api/risk/rescore').set(auth).send({})
    expect(rescored.status).toBe(200)
    expect(rescored.body.scored).toBe(30)
    const kept = await prisma.tenantRisk.findUniqueOrThrow({ where: { id: highId } })
    expect(kept.status).toBe('approved')
    const readOnly = await authAs('tom@acme.example.com')
    const draft = await prisma.tenantRisk.findFirst({ where: { organisationId: kept.organisationId, status: 'draft' } })
    expect((await request(app).post(`/api/risk/${draft!.id}/review`).set(readOnly).send({ decision: 'dismiss' })).status).toBe(403)
    const dismissed = await request(app).post(`/api/risk/${draft!.id}/review`).set(auth).send({ decision: 'dismiss', note: 'Spoke to the tenant already.' })
    expect(dismissed.body.status).toBe('dismissed')
  })

  it('hides the other company\'s scores', async () => {
    const kestrel = await authAs('claire@kestrel.example.com')
    expect((await request(app).get(`/api/risk/${highId}`).set(kestrel)).status).toBe(404)
    expect((await request(app).post(`/api/risk/${highId}/review`).set(kestrel).send({ decision: 'approve' })).status).toBe(404)
  })
})
