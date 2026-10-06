import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { app, demoAuth, hasDb } from './helpers'

const DATA = join(__dirname, '../../data/documents')
const pdf = (file: string) => readFileSync(join(DATA, file))

// Uploaded files and pushed bills go to a temporary folder, not server/storage.
const scratch = mkdtempSync(join(tmpdir(), 'documents-api-'))
process.env.DOCUMENT_STORAGE_DIR = join(scratch, 'documents')
process.env.ACCOUNTING_MOCK_FILE = join(scratch, 'mock-bills.json')

const runFor = (id: number) => prisma.automationRun.findFirst({ where: { itemRef: `document:${id}` }, orderBy: { id: 'desc' } })

describe.skipIf(!hasDb)('documents API', () => {
  let auth: { Authorization: string }
  const upload = (file: string) => request(app).post('/api/documents').set(auth).attach('file', pdf(file), file)

  beforeAll(async () => {
    auth = await demoAuth()
  })

  it('needs a token', async () => {
    expect((await request(app).get('/api/documents')).status).toBe(401)
    expect((await request(app).get('/api/documents/export/xero-bills.csv')).status).toBe(401)
  })

  it('says which method reads uploads (rules when no model is configured)', async () => {
    const res = await request(app).get('/api/documents/method').set(auth)
    expect(res.body).toMatchObject({ method: 'rules', aiEnabled: false })
  })

  it('refuses a missing file and a file that is not a PDF', async () => {
    expect((await request(app).post('/api/documents').set(auth)).status).toBe(400)
    const notPdf = await request(app).post('/api/documents').set(auth).attach('file', Buffer.from('hello'), 'note.pdf')
    expect(notPdf.status).toBe(400)
    expect(notPdf.body.error).toMatch(/not a PDF/)
  })

  it('reads, checks and queues an uploaded invoice, linked to its property, contractor and job', async () => {
    const res = await upload('invoice-02-plumbing-pon7.pdf')
    expect(res.status).toBe(201)
    const doc = res.body
    expect(doc).toMatchObject({
      kind: 'invoice',
      method: 'rules',
      status: 'needs_review',
      invoiceNumber: 'AP-2296',
      total: 181.7,
      gst: 23.7,
      issues: [],
    })
    expect(doc.invoiceDate).toMatch(/^2026-09-08/)
    expect(doc.property.address).toBe('7 Vine Street')
    expect(doc.contractor.name).toBe('Acme Plumbing')
    expect(doc.maintenanceRequest.title).toBe('Leaking kitchen mixer')
    expect(doc.extracted.supplierGstNumber).toEqual({ value: '102-345-673', confidence: 'medium', source: 'rules' })
    expect(doc.extracted.lineItems.value).toHaveLength(2)

    const run = await runFor(doc.id)
    expect(run).toMatchObject({ automation: 'invoice_extraction', outcome: 'auto', baselineMinutes: 12 })
  })

  it('flags the same invoice sent again as a duplicate', async () => {
    const res = await upload('invoice-03-plumbing-pon7.pdf')
    expect(res.body.issues.map((i: { code: string }) => i.code)).toEqual(['duplicate_invoice'])
  })

  it('lists documents without their text, and returns the detail and the original PDF', async () => {
    const list = await request(app).get('/api/documents').set(auth)
    expect(list.status).toBe(200)
    expect(list.body.length).toBeGreaterThanOrEqual(2)
    expect(list.body[0].text).toBeUndefined()

    const id = list.body.find((d: { fileName: string }) => d.fileName === 'invoice-02-plumbing-pon7.pdf').id
    const detail = await request(app).get(`/api/documents/${id}`).set(auth)
    expect(detail.body.text).toContain('Invoice # AP-2296')

    const file = await request(app).get(`/api/documents/${id}/file`).set(auth).buffer(true)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('application/pdf')
    expect(Buffer.from(file.body).subarray(0, 4).toString()).toBe('%PDF')

    expect((await request(app).get('/api/documents/999999').set(auth)).status).toBe(404)
    expect((await request(app).get('/api/documents/999999/file').set(auth)).status).toBe(404)
  })

  it('approves with a correction, records the review time and outcome, and refuses a second decision', async () => {
    const list = await request(app).get('/api/documents?status=needs_review').set(auth)
    const doc = list.body.find((d: { fileName: string }) => d.fileName === 'invoice-02-plumbing-pon7.pdf')

    const invalid = await request(app).post(`/api/documents/${doc.id}/approve`).set(auth).send({ fields: { dueDate: '22/09/2026' } })
    expect(invalid.status).toBe(400)

    const res = await request(app)
      .post(`/api/documents/${doc.id}/approve`)
      .set(auth)
      .send({ fields: { invoiceNumber: 'AP-2296', dueDate: '2026-09-29' }, reviewSeconds: 42 })
    expect(res.status).toBe(200)
    expect(res.body.changedFields).toEqual(['dueDate'])
    expect(res.body.document.status).toBe('approved')
    expect(res.body.document.extracted.dueDate).toEqual({ value: '2026-09-29', confidence: 'high', source: 'person' })
    expect(res.body.document.dueDate).toMatch(/^2026-09-29/)
    expect(await runFor(doc.id)).toMatchObject({ outcome: 'corrected', reviewSeconds: 42 })

    const again = await request(app).post(`/api/documents/${doc.id}/approve`).set(auth).send({ reviewSeconds: 3 })
    expect(again.status).toBe(409)
  })

  it('records an approval without changes as reviewed, and needs the key fields', async () => {
    const created = (await upload('invoice-10-gardens-pap18.pdf')).body
    const missing = await request(app).post(`/api/documents/${created.id}/approve`).set(auth).send({ fields: { invoiceNumber: '' } })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toMatch(/invoice number/)

    const ok = await request(app).post(`/api/documents/${created.id}/approve`).set(auth).send({ reviewSeconds: 20 })
    expect(ok.body.changedFields).toEqual([])
    expect(await runFor(created.id)).toMatchObject({ outcome: 'reviewed', reviewSeconds: 20 })
  })

  it('rejects a document with a reason', async () => {
    const list = await request(app).get('/api/documents?status=needs_review').set(auth)
    const duplicate = list.body.find((d: { fileName: string }) => d.fileName === 'invoice-03-plumbing-pon7.pdf')
    const res = await request(app)
      .post(`/api/documents/${duplicate.id}/reject`)
      .set(auth)
      .send({ reviewSeconds: 15, reason: 'Duplicate of AP-2296' })
    expect(res.body.status).toBe('rejected')
    expect(res.body.issues.at(-1)).toMatchObject({ code: 'rejected', message: 'Rejected: Duplicate of AP-2296' })
    expect(await runFor(duplicate.id)).toMatchObject({ outcome: 'rejected', reviewSeconds: 15 })
  })

  it('pushes one approved invoice to the mock accounting adapter as a draft bill', async () => {
    const list = await request(app).get('/api/documents?status=approved').set(auth)
    const gardens = list.body.find((d: { fileName: string }) => d.fileName === 'invoice-10-gardens-pap18.pdf')
    const res = await request(app).post(`/api/documents/${gardens.id}/push`).set(auth)
    expect(res.status).toBe(200)
    expect(res.body.bill).toMatchObject({ status: 'DRAFT', contactName: 'Acme Gardens', invoiceNumber: 'G-5521', total: 179.4 })
    expect(res.body.document.status).toBe('exported')
    expect((await request(app).post(`/api/documents/${gardens.id}/push`).set(auth)).status).toBe(409)

    const bills = await request(app).get('/api/documents/accounting/bills').set(auth)
    expect(bills.body.bills.map((b: { invoiceNumber: string }) => b.invoiceNumber)).toContain('G-5521')
  })

  it('exports approved invoices as a Xero bill-import CSV and marks them exported', async () => {
    const res = await request(app).get('/api/documents/export/xero-bills.csv').set(auth)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="xero-bills-/)
    const rows = res.text.trimEnd().split('\r\n')
    expect(rows[0]).toBe('*ContactName,EmailAddress,*InvoiceNumber,*InvoiceDate,*DueDate,Description,*Quantity,*UnitAmount,*AccountCode,*TaxType,Currency')
    expect(rows.slice(1)).toEqual([
      'Acme Plumbing,accounts@acme-plumbing.example.com,AP-2296,08/09/2026,29/09/2026,Kitchen mixer cartridge (supply),1,58.00,473,15% GST on Expenses,NZD',
      'Acme Plumbing,accounts@acme-plumbing.example.com,AP-2296,08/09/2026,29/09/2026,"Labour, replace cartridge and re-seal (hours)",1.25,80.00,473,15% GST on Expenses,NZD',
    ])
    const after = await request(app).get('/api/documents?status=exported').set(auth)
    expect(after.body.map((d: { invoiceNumber: string }) => d.invoiceNumber)).toContain('AP-2296')
    expect((await request(app).get('/api/documents/export/xero-bills.csv').set(auth)).status).toBe(404)
  })

  it('reads a tenancy summary, links the lease and compares rent and bond with it', async () => {
    const res = await upload('lease-02-pon7.pdf')
    expect(res.body).toMatchObject({ kind: 'lease', status: 'needs_review', invoiceNumber: null })
    expect(res.body.lease.tenant).toEqual({ firstName: 'Daniel', lastName: 'Kim' })
    expect(res.body.extracted.weeklyRent.value).toBe(680)
    expect(res.body.issues.map((i: { code: string }) => i.code)).toEqual(['rent_differs'])
    expect(await runFor(res.body.id)).toMatchObject({ automation: 'lease_extraction', baselineMinutes: 25 })
  })

  it("keeps each manager's documents to themselves", async () => {
    const other = await request(app)
      .post('/api/auth/register')
      .send({ email: 'other.manager@example.com', password: 'other1234', name: 'Other Manager' })
    const otherAuth = { Authorization: `Bearer ${other.body.token}` }
    const mine = (await request(app).get('/api/documents').set(auth)).body[0]
    expect((await request(app).get(`/api/documents/${mine.id}`).set(otherAuth)).status).toBe(404)
    expect((await request(app).get(`/api/documents/${mine.id}/file`).set(otherAuth)).status).toBe(404)
    expect((await request(app).get('/api/documents').set(otherAuth)).body).toEqual([])
  })
})
