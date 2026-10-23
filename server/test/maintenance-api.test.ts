// Maintenance triage on the API: a tenant's request becomes a job with a draft work order; a person approves it
// within the role's budget limit; everything lands in the audit trail. Rules route (AI_DRIVER=off in the test config).
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { app, authAs, demoAuth, hasDb } from './helpers'

describe.skipIf(!hasDb)('maintenance triage API', () => {
  let manager: { Authorization: string }
  let propertyManager: { Authorization: string }
  let accounts: { Authorization: string }
  let propertyId: number
  let jobId: number

  beforeAll(async () => {
    manager = await demoAuth()
    propertyManager = await authAs('sarah@acme.example.com')
    accounts = await authAs('james@acme.example.com')
    propertyId = (await prisma.property.findFirstOrThrow({ where: { code: 'TAK9' } })).id
  })

  it('reports the method and lists the company\'s sample requests without their labels', async () => {
    const method = await request(app).get('/api/maintenance/method').set(manager)
    expect(method.body.method).toBe('rules')
    expect(method.body.categories.map((c: { key: string }) => c.key)).toContain('gas_heating')
    const samples = await request(app).get('/api/maintenance/samples').set(manager)
    expect(samples.body.length).toBeGreaterThan(20)
    expect(samples.body[0].company).toBe('acme')
    expect(samples.body[0].labels).toBeUndefined()
    const kestrel = await request(app).get('/api/maintenance/samples').set(await authAs('claire@kestrel.example.com'))
    expect(kestrel.body.every((s: { company: string }) => s.company === 'kestrel')).toBe(true)
  })

  it('triages a request into a job with category, urgency, safety flags, a contractor and a budget band', async () => {
    const res = await request(app)
      .post('/api/maintenance/triage')
      .set(propertyManager)
      .send({ propertyId, text: "There's a strong smell of gas by the hob and a hissing sound. I'm home until 3pm.", photoNote: 'Hob with the knobs off' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    jobId = res.body.id
    expect(res.body).toMatchObject({ category: 'gas_heating', priority: 'urgent', source: 'tenant_request', triageMethod: 'rules', status: 'open' })
    expect(res.body.triage.safety).toEqual(['gas'])
    expect(res.body.workOrder.contractor.name).toBe('Acme Gas & Heating')
    expect(res.body.workOrder.accessNotes).toContain('home until 3pm')
    expect(res.body.workOrder.budget.low).toBeLessThanOrEqual(res.body.workOrder.budget.high)
    expect(res.body.workOrder.safetyNotes.join(' ')).toContain('gas')
    expect(res.body.property.code).toBe('TAK9')
    const run = await prisma.automationRun.findFirst({ where: { itemRef: `maintenance:${jobId}` } })
    expect(run).toMatchObject({ automation: 'maintenance_triage', outcome: 'auto', baselineMinutes: 10 })
    expect((await request(app).post('/api/maintenance/triage').set(manager).send({ propertyId, text: 'x' })).status).toBe(400)
    expect((await request(app).post('/api/maintenance/triage').set(manager).send({ text: 'The tap drips' })).status).toBe(400)
  })

  it('triages a sample as if just received', async () => {
    const res = await request(app).post('/api/maintenance/samples/M06').set(manager)
    expect(res.status).toBe(201)
    expect(res.body.category).toBe('plumbing')
    expect(res.body.priority).toBe('low')
    expect((await request(app).post('/api/maintenance/samples/M21').set(manager)).status).toBe(404) // a Kestrel sample
  })

  it('applies the work-order limit per role and records the approval', async () => {
    // Accounts may approve work orders up to 1000; a 1500 budget needs a property manager or a manager.
    const tooMuch = await request(app).post(`/api/maintenance/${jobId}/work-order/approve`).set(accounts).send({ budgetHigh: 1500, reviewSeconds: 30 })
    expect(tooMuch.status).toBe(403)
    expect(tooMuch.body.error).toContain('needs a manager')
    const ok = await request(app).post(`/api/maintenance/${jobId}/work-order/approve`).set(propertyManager).send({ budgetHigh: 1500, scope: 'Isolate the gas, find and repair the leak, test and certify.', reviewSeconds: 30 })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('in_progress')
    expect(ok.body.contractor.name).toBe('Acme Gas & Heating')
    expect(ok.body.quoteAmount).toBe(1500)
    expect(ok.body.workOrder.status).toBe('approved')
    expect(ok.body.workOrder.scope).toContain('certify')
    expect((await request(app).post(`/api/maintenance/${jobId}/work-order/approve`).set(manager).send({})).status).toBe(409)
    const run = await prisma.automationRun.findFirst({ where: { itemRef: `maintenance:${jobId}` }, orderBy: { id: 'desc' } })
    expect(run).toMatchObject({ outcome: 'corrected', reviewSeconds: 30 })
    const audit = await request(app).get('/api/audit?entity=maintenance').set(manager)
    const events = audit.body.filter((e: { entityId: number }) => e.entityId === jobId).map((e: { action: string; user: { name: string } }) => `${e.action}:${e.user.name}`)
    expect(events).toContain('maintenance.triaged:Sarah Bell')
    expect(events).toContain('maintenance.work_order_approved:Sarah Bell')
  })

  it('lets a person reject a draft, and only a user of the same company', async () => {
    const res = await request(app).post('/api/maintenance/triage').set(manager).send({ propertyId, text: 'The letterbox door has fallen off, no rush.' })
    expect(res.body.priority).toBe('low')
    const kestrel = await authAs('claire@kestrel.example.com')
    expect((await request(app).post(`/api/maintenance/${res.body.id}/work-order/reject`).set(kestrel).send({ reason: 'x' })).status).toBe(404)
    const rejected = await request(app).post(`/api/maintenance/${res.body.id}/work-order/reject`).set(manager).send({ reason: 'Tenant will fix it.', reviewSeconds: 5 })
    expect(rejected.status).toBe(200)
    expect(rejected.body.workOrder.status).toBe('rejected')
    expect(rejected.body.status).toBe('open')
  })
})
