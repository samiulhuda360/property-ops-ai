// Companies and roles: a user never sees or changes another company's data, a read-only user changes nothing,
// and approval limits hold per role. Runs on the seeded test database (two companies, four users each).
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { APPROVAL_LIMITS, assertCanApprove, PermissionError } from '../src/lib/actor'
import { prisma } from '../src/lib/prisma'
import { app, authAs, hasDb } from './helpers'

describe('approval limits (no database)', () => {
  const actor = (role: 'manager' | 'accounts' | 'property_manager' | 'read_only') => ({ userId: 1, organisationId: 1, role })

  it('lets each role approve up to its limit and no further', () => {
    expect(() => assertCanApprove(actor('accounts'), 'invoice', APPROVAL_LIMITS.accounts.invoice)).not.toThrow()
    expect(() => assertCanApprove(actor('accounts'), 'invoice', APPROVAL_LIMITS.accounts.invoice + 1)).toThrow(PermissionError)
    expect(() => assertCanApprove(actor('property_manager'), 'workOrder', 2500)).not.toThrow()
    expect(() => assertCanApprove(actor('property_manager'), 'workOrder', 2600)).toThrow(/needs a manager/)
    expect(() => assertCanApprove(actor('manager'), 'invoice', 1_000_000)).not.toThrow()
  })

  it('never lets a read-only user decide, even with no money involved', () => {
    expect(() => assertCanApprove(actor('read_only'), 'invoice', null)).toThrow(PermissionError)
    expect(() => assertCanApprove(actor('read_only'), 'workOrder', 0)).toThrow(/look but not approve/)
  })
})

describe.skipIf(!hasDb)('companies and roles on the API', () => {
  let acme: { Authorization: string }
  let kestrel: { Authorization: string }
  let acmeReadOnly: { Authorization: string }
  let acmeAccounts: { Authorization: string }
  let acmePropertyId: number
  let kestrelPropertyId: number

  beforeAll(async () => {
    acme = await authAs('demo@example.com')
    kestrel = await authAs('claire@kestrel.example.com')
    acmeReadOnly = await authAs('tom@acme.example.com')
    acmeAccounts = await authAs('james@acme.example.com')
    acmePropertyId = (await prisma.property.findFirstOrThrow({ where: { code: 'MTE14' } })).id
    kestrelPropertyId = (await prisma.property.findFirstOrThrow({ where: { code: 'DID14' } })).id
  })

  it('tells each user who they are, which company and which role', async () => {
    const me = await request(app).get('/api/auth/me').set(acmeAccounts)
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ email: 'james@acme.example.com', role: 'accounts', organisation: { slug: 'acme' } })
    expect(me.body.limits.invoice).toBe(5000)
    const claire = await request(app).get('/api/auth/me').set(kestrel)
    expect(claire.body).toMatchObject({ role: 'manager', organisation: { slug: 'kestrel', currency: 'GBP' } })
    expect(claire.body.limits.invoice).toBeNull()
  })

  it('lists only the signed-in company\'s properties, tenants and contractors', async () => {
    const a = await request(app).get('/api/properties').set(acme)
    const k = await request(app).get('/api/properties').set(kestrel)
    expect(a.body.map((p: { code: string }) => p.code)).toContain('MTE14')
    expect(a.body.map((p: { code: string }) => p.code)).not.toContain('DID14')
    expect(k.body.map((p: { code: string }) => p.code)).toContain('DID14')
    expect(k.body.map((p: { code: string }) => p.code)).not.toContain('MTE14')
    const contractors = await request(app).get('/api/contractors').set(kestrel)
    expect(contractors.body.every((c: { name: string }) => c.name.startsWith('Kestrel'))).toBe(true)
    const tenants = await request(app).get('/api/tenants').set(kestrel)
    expect(tenants.body.some((t: { lastName: string }) => t.lastName === 'Ngata')).toBe(false)
  })

  it('cannot read, change or delete another company\'s records by id', async () => {
    expect((await request(app).get(`/api/properties/${acmePropertyId}`).set(kestrel)).status).toBe(404)
    expect((await request(app).put(`/api/properties/${acmePropertyId}`).set(kestrel).send({ address: 'Hacked', suburb: 'x', city: 'x', bedrooms: 1, bathrooms: 1, rentPrice: 1 })).status).toBe(404)
    expect((await request(app).delete(`/api/properties/${acmePropertyId}`).set(kestrel)).status).toBe(404)
    const untouched = await prisma.property.findUniqueOrThrow({ where: { id: acmePropertyId } })
    expect(untouched.address).toBe('14 Kowhai Road')

    // A maintenance request or a lease can only be created against the caller's own property.
    const job = await request(app).post('/api/maintenance').set(kestrel).send({ propertyId: acmePropertyId, title: 'x', description: 'y' })
    expect(job.status).toBe(404)
    const triage = await request(app).post('/api/maintenance/triage').set(kestrel).send({ propertyId: acmePropertyId, text: 'The tap is dripping in the kitchen.' })
    expect(triage.status).toBe(404)
  })

  it('scopes the audit trail, risk scores and reports to the company', async () => {
    const audit = await request(app).get('/api/audit').set(kestrel)
    expect(audit.status).toBe(200)
    for (const e of audit.body) expect(e.user.email.endsWith('@kestrel.example.com')).toBe(true)
    const risks = await request(app).get('/api/risk').set(kestrel)
    for (const r of risks.body) expect(r.lease.property.code).not.toBe('MTE14')
    const queue = await request(app).get('/api/reports/work-queue').set(kestrel)
    expect(queue.status).toBe(200)
  })

  it('lets a read-only user look but not change anything', async () => {
    expect((await request(app).get('/api/properties').set(acmeReadOnly)).status).toBe(200)
    expect((await request(app).get('/api/audit').set(acmeReadOnly)).status).toBe(200)
    const create = await request(app).post('/api/properties').set(acmeReadOnly).send({ address: '1 Test Street', suburb: 'x', city: 'x', bedrooms: 1, bathrooms: 1, rentPrice: 1 })
    expect(create.status).toBe(403)
    expect(create.body.error).toContain('read-only')
    expect((await request(app).put(`/api/properties/${acmePropertyId}`).set(acmeReadOnly).send({ address: 'x' })).status).toBe(403)
    expect((await request(app).post('/api/inbox/demo').set(acmeReadOnly)).status).toBe(403)
    expect((await request(app).post('/api/risk/rescore').set(acmeReadOnly)).status).toBe(403)
    expect(await prisma.property.count({ where: { address: '1 Test Street' } })).toBe(0)
  })

  it('applies the invoice approval limit per role', async () => {
    // Two invoices with the same text: one under the accounts limit, one over it.
    const manager = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@example.com' } })
    const make = (total: number) =>
      prisma.document.create({
        data: {
          userId: manager.id,
          organisationId: manager.organisationId,
          kind: 'invoice',
          fileName: `limit-${total}.pdf`,
          text: 'test',
          method: 'rules',
          extracted: {
            supplierName: { value: 'Acme Plumbing', confidence: 'high', source: 'rules' },
            invoiceNumber: { value: `LIM-${total}`, confidence: 'high', source: 'rules' },
            invoiceDate: { value: '2026-09-01', confidence: 'high', source: 'rules' },
            dueDate: { value: '2026-09-20', confidence: 'high', source: 'rules' },
            total: { value: total, confidence: 'high', source: 'rules' },
          },
          issues: [],
          status: 'needs_review',
          total,
        },
      })
    const small = await make(1200)
    const big = await make(8200)
    const okAccounts = await request(app).post(`/api/documents/${small.id}/approve`).set(acmeAccounts).send({ reviewSeconds: 10 })
    expect(okAccounts.status, JSON.stringify(okAccounts.body)).toBe(200)
    const tooBig = await request(app).post(`/api/documents/${big.id}/approve`).set(acmeAccounts).send({ reviewSeconds: 10 })
    expect(tooBig.status).toBe(403)
    expect(tooBig.body.error).toContain('needs a manager')
    expect((await prisma.document.findUniqueOrThrow({ where: { id: big.id } })).status).toBe('needs_review')
    const pm = await authAs('sarah@acme.example.com')
    expect((await request(app).post(`/api/documents/${big.id}/approve`).set(pm).send({ reviewSeconds: 10 })).status).toBe(403)
    const okManager = await request(app).post(`/api/documents/${big.id}/approve`).set(acme).send({ reviewSeconds: 10 })
    expect(okManager.status).toBe(200)
    // Both approvals are in the audit trail with the right person.
    const audit = await request(app).get('/api/audit?entity=document&action=document.approved').set(acme)
    const names = audit.body.filter((e: { entityId: number }) => [small.id, big.id].includes(e.entityId)).map((e: { user: { name: string } }) => e.user.name)
    expect(names.sort()).toEqual(['Emma Walker', 'James Hart'])
    await prisma.automationRun.deleteMany({ where: { itemRef: { in: [`document:${small.id}`, `document:${big.id}`] } } })
    await prisma.document.deleteMany({ where: { id: { in: [small.id, big.id] } } })
  })

  it('lets only a manager change roles, never their own away from manager, never in another company', async () => {
    const users = await request(app).get('/api/auth/users').set(acme)
    expect(users.status).toBe(200)
    expect(users.body.users.map((u: { email: string }) => u.email)).toContain('tom@acme.example.com')
    const tom = users.body.users.find((u: { email: string }) => u.email === 'tom@acme.example.com')
    const me = users.body.users.find((u: { email: string }) => u.email === 'demo@example.com')
    expect((await request(app).put(`/api/auth/users/${tom.id}/role`).set(acmeAccounts).send({ role: 'manager' })).status).toBe(403)
    expect((await request(app).put(`/api/auth/users/${tom.id}/role`).set(kestrel).send({ role: 'manager' })).status).toBe(404)
    expect((await request(app).put(`/api/auth/users/${me.id}/role`).set(acme).send({ role: 'accounts' })).status).toBe(400)
    expect((await request(app).put(`/api/auth/users/${tom.id}/role`).set(acme).send({ role: 'owner' })).status).toBe(400)
    const changed = await request(app).put(`/api/auth/users/${tom.id}/role`).set(acme).send({ role: 'property_manager' })
    expect(changed.status).toBe(200)
    // The new role applies at once: Tom can now create a property with his existing token.
    const create = await request(app).post('/api/properties').set(acmeReadOnly).send({ address: '2 Role Street', suburb: 'x', city: 'Auckland', bedrooms: 1, bathrooms: 1, rentPrice: 500 })
    expect(create.status).toBe(201)
    await request(app).put(`/api/auth/users/${tom.id}/role`).set(acme).send({ role: 'read_only' })
    expect((await request(app).delete(`/api/properties/${create.body.id}`).set(acmeReadOnly)).status).toBe(403)
    await prisma.property.delete({ where: { id: create.body.id } })
  })

  it('registers a new company with its first user as manager', async () => {
    await prisma.user.deleteMany({ where: { email: 'new-company@example.com' } })
    const reg = await request(app).post('/api/auth/register').send({ email: 'new-company@example.com', password: 'test1234', name: 'Nina Cole', company: 'Harbour Homes' })
    expect(reg.status).toBe(201)
    expect(reg.body.user).toMatchObject({ role: 'manager', organisation: { name: 'Harbour Homes', slug: 'harbour-homes' } })
    const auth = { Authorization: `Bearer ${reg.body.token}` }
    expect((await request(app).get('/api/properties').set(auth)).body).toEqual([])
    expect((await request(app).get(`/api/properties/${kestrelPropertyId}`).set(auth)).status).toBe(404)
    await prisma.organisation.delete({ where: { id: reg.body.user.organisation.id } })
  })
})
