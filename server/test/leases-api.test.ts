// The lease abstraction API on a fresh database (rules route: AI_DRIVER=off in the test config).
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { app, demoAuth, hasDb } from './helpers'

const DATA = resolve(__dirname, '../../data/leases')

describe.runIf(hasDb)('lease abstraction API', () => {
  let auth: { Authorization: string }
  let id: number

  beforeAll(async () => {
    auth = await demoAuth()
    const user = await prisma.user.findUnique({ where: { email: 'demo@example.com' } })
    await prisma.leaseAbstract.deleteMany({ where: { userId: user!.id } })
    await prisma.issuedInvoice.deleteMany({ where: { userId: user!.id } })
  })

  it('reports the route and the term list', async () => {
    const res = await request(app).get('/api/lease-abstracts/method').set(auth)
    expect(res.status).toBe(200)
    expect(res.body.route).toBe('rules')
    expect(res.body.fields.map((f: { key: string }) => f.key)).toContain('breakNoticeMonths')
  })

  it('imports the issued invoices', async () => {
    const res = await request(app).post('/api/lease-abstracts/invoices').set(auth).attach('file', join(DATA, 'invoices.csv'))
    expect(res.status).toBe(200)
    expect(res.body.imported).toBe(521)
  })

  it('lists the samples and abstracts one with terms, pages, risks, charges and a reconciliation', async () => {
    const samples = await request(app).get('/api/lease-abstracts/samples').set(auth)
    expect(samples.status).toBe(200)
    expect(samples.body.find((s: { file: string }) => s.file === 'lease-c-nz-01.pdf').available).toBe(true)

    const res = await request(app).post('/api/lease-abstracts/samples/lease-c-nz-01.pdf').set(auth)
    expect(res.status).toBe(201)
    id = res.body.id
    expect(res.body.route).toBe('rules')
    expect(res.body.country).toBe('NZ')
    expect(res.body.leaseType).toBe('commercial')
    expect(res.body.leaseRef).toBe('ACM-NZ-C-01')
    expect(res.body.terms.rentAmount).toMatchObject({ value: 7000, page: 1, confidence: 'medium', status: 'extracted' })
    expect(res.body.terms.rentAmount.quote).toContain('7,000.00')
    expect(res.body.risks.map((r: { code: string }) => r.code).sort()).toEqual(['make_good_tenant_cost', 'personal_guarantee', 'uncapped_outgoings'])
    expect(res.body.charges).toHaveLength(25)
    expect(res.body.reconciliation.counts).toEqual({ matched: 24, amount_differs: 1, missing: 0, unexpected: 0 })
    const differs = res.body.reconciliation.lines.find((l: { status: string }) => l.status === 'amount_differs')
    expect(differs.invoice.row).toBeGreaterThan(1)
    expect(differs.note).toContain('row')
  })

  it('records the extraction in the audit trail and the automation runs', async () => {
    const audit = await request(app).get(`/api/lease-abstracts/${id}/audit`).set(auth)
    expect(audit.status).toBe(200)
    expect(audit.body).toHaveLength(1)
    expect(audit.body[0].action).toBe('lease.extracted')
    expect(audit.body[0].user.name).toBeTruthy()
    const run = await prisma.automationRun.findFirst({ where: { itemRef: `lease:${id}` } })
    expect(run?.automation).toBe('lease_abstraction')
    expect(run?.baselineMinutes).toBe(45)
  })

  it('uploads a PDF, and rejects a file that is not one', async () => {
    const ok = await request(app).post('/api/lease-abstracts').set(auth).attach('file', join(DATA, 'heldout', 'lease-h-uk-02.pdf'))
    expect(ok.status).toBe(201)
    expect(ok.body.country).toBe('UK')
    const bad = await request(app).post('/api/lease-abstracts').set(auth).attach('file', Buffer.from('not a pdf'), 'x.pdf')
    expect(bad.status).toBe(400)
  })

  it('serves the original PDF and the exports', async () => {
    const file = await request(app).get(`/api/lease-abstracts/${id}/file`).set(auth)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toContain('application/pdf')
    const json = await request(app).get(`/api/lease-abstracts/${id}/export`).set(auth)
    expect(json.status).toBe(200)
    expect(json.body.terms.tenant.value).toBe('Harbourline Coffee Limited')
    const csv = await request(app).get(`/api/lease-abstracts/${id}/export?format=csv`).set(auth)
    expect(csv.status).toBe(200)
    expect(csv.text).toContain('term,Rent per period,7000,1,medium,extracted')
    expect(csv.text).toContain('charge,rent,"Rent, month 4",7000.00,NZD,2026-07-01,2026-07-01 to 2026-07-31,"amount_differs (INV-1009, row 10)"')
  })

  it('approves a term as read, corrects another, and writes both to the audit trail', async () => {
    const approved = await request(app).post(`/api/lease-abstracts/${id}/fields/tenant`).set(auth).send({ approve: true })
    expect(approved.status).toBe(200)
    expect(approved.body.terms.tenant).toMatchObject({ status: 'approved', confidence: 'high' })

    const bad = await request(app).post(`/api/lease-abstracts/${id}/fields/rentAmount`).set(auth).send({ value: 'lots' })
    expect(bad.status).toBe(400)

    const corrected = await request(app).post(`/api/lease-abstracts/${id}/fields/rentAmount`).set(auth).send({ value: 7100 })
    expect(corrected.status).toBe(200)
    expect(corrected.body.terms.rentAmount).toMatchObject({ value: 7100, status: 'corrected', source: 'person' })
    // The checks re-run: the annual rent no longer agrees, so it goes to a person; the charges follow the correction.
    expect(corrected.body.issues.some((i: { code: string }) => i.code === 'annual_rent_disagrees')).toBe(true)
    expect(corrected.body.terms.annualRent.status).toBe('needs_person')
    expect(corrected.body.charges.find((c: { kind: string }) => c.kind === 'rent').amount).toBe(7100)
    expect(corrected.body.reconciliation.counts.amount_differs).toBe(12)

    const unknown = await request(app).post(`/api/lease-abstracts/${id}/fields/colour`).set(auth).send({ approve: true })
    expect(unknown.status).toBe(400)

    const audit = await request(app).get(`/api/lease-abstracts/${id}/audit`).set(auth)
    const actions = audit.body.map((e: { action: string; field: string | null }) => `${e.action}:${e.field ?? ''}`)
    expect(actions).toContain('lease.field_approved:tenant')
    expect(actions).toContain('lease.field_corrected:rentAmount')
    const event = audit.body.find((e: { action: string }) => e.action === 'lease.field_corrected')
    expect(event.before).toBe(7000)
    expect(event.after).toBe(7100)
  })

  it('decides a risk finding', async () => {
    const res = await request(app).post(`/api/lease-abstracts/${id}/risks/personal_guarantee`).set(auth).send({ status: 'accepted', note: 'Guarantor confirmed.' })
    expect(res.status).toBe(200)
    expect(res.body.risks.find((r: { code: string }) => r.code === 'personal_guarantee').status).toBe('accepted')
    const bad = await request(app).post(`/api/lease-abstracts/${id}/risks/personal_guarantee`).set(auth).send({ status: 'maybe' })
    expect(bad.status).toBe(400)
  })

  it('refuses final approval while a term needs a person, then approves', async () => {
    const blocked = await request(app).post(`/api/lease-abstracts/${id}/approve`).set(auth).send({ reviewSeconds: 90 })
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toContain('annual rent')

    await request(app).post(`/api/lease-abstracts/${id}/fields/annualRent`).set(auth).send({ value: 85200 })
    const ok = await request(app).post(`/api/lease-abstracts/${id}/approve`).set(auth).send({ reviewSeconds: 90 })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
    const again = await request(app).post(`/api/lease-abstracts/${id}/fields/tenant`).set(auth).send({ approve: true })
    expect(again.status).toBe(409)
    const run = await prisma.automationRun.findFirst({ where: { itemRef: `lease:${id}` } })
    expect(run).toMatchObject({ outcome: 'corrected', reviewSeconds: 90 })
    const audit = await request(app).get(`/api/lease-abstracts/${id}/audit`).set(auth)
    expect(audit.body.at(-1).action).toBe('lease.approved')
  })

  it('lists leases by status and keeps them to their owner', async () => {
    const approved = await request(app).get('/api/lease-abstracts?status=approved').set(auth)
    expect(approved.body.map((l: { id: number }) => l.id)).toContain(id)
    const other = await request(app).get(`/api/lease-abstracts/${id}`)
    expect(other.status).toBe(401)
  })

  it('rejects a lease with a reason', async () => {
    const res = await request(app).post('/api/lease-abstracts/samples/lease-r-au-01.pdf').set(auth)
    const rejected = await request(app).post(`/api/lease-abstracts/${res.body.id}/reject`).set(auth).send({ reviewSeconds: 10, reason: 'Wrong file' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.status).toBe('rejected')
    const audit = await request(app).get(`/api/lease-abstracts/${res.body.id}/audit`).set(auth)
    expect(audit.body.at(-1).note).toBe('Rejected: Wrong file')
  })
})
