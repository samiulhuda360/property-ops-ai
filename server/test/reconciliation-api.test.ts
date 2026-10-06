import ExcelJS from 'exceljs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { loadTruth, readDemoStatement } from '../src/reconciliation/fixture'
import { importStatement } from '../src/reconciliation/service'
import { app, demoAuth, hasDb } from './helpers'

const truth = loadTruth()
const csv = readDemoStatement()
const rowOf = (name: string, n = 0) => truth.lines.filter((l) => l.case === name)[n].row

/** A new manager with a copy of the demo portfolio, so these tests never change the demo user's data. */
async function managerWithDemoPortfolio(email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'test-pass-1', name: 'Reconciliation Test' })
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`)
  const userId: number = res.body.user.id
  const demo = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@example.com' } })
  const contractorIds = new Map<number, number>()
  for (const c of await prisma.contractor.findMany({ where: { userId: demo.id }, orderBy: { id: 'asc' } })) {
    const copy = await prisma.contractor.create({
      data: { userId, name: c.name, trade: c.trade, email: c.email, gstNumber: c.gstNumber, bankAccount: c.bankAccount },
    })
    contractorIds.set(c.id, copy.id)
  }
  const properties = await prisma.property.findMany({
    where: { userId: demo.id },
    include: { leases: { include: { tenant: true, payments: true } }, maintenance: true },
    orderBy: { id: 'asc' },
  })
  for (const p of properties) {
    const property = await prisma.property.create({
      data: { userId, code: p.code, address: p.address, suburb: p.suburb, city: p.city, bedrooms: p.bedrooms, bathrooms: p.bathrooms, rentPrice: p.rentPrice, status: p.status },
    })
    for (const l of p.leases) {
      const tenant = await prisma.tenant.create({
        data: { userId, firstName: l.tenant.firstName, lastName: l.tenant.lastName, email: l.tenant.email, phone: l.tenant.phone },
      })
      const lease = await prisma.lease.create({
        data: { propertyId: property.id, tenantId: tenant.id, startDate: l.startDate, endDate: l.endDate, weeklyRent: l.weeklyRent, bondAmount: l.bondAmount, rentReference: l.rentReference, status: l.status },
      })
      await prisma.payment.createMany({
        data: l.payments.map((x) => ({ leaseId: lease.id, amount: x.amount, dueDate: x.dueDate, paidDate: x.paidDate, status: x.status })),
      })
    }
    for (const m of p.maintenance) {
      await prisma.maintenanceRequest.create({
        data: {
          propertyId: property.id,
          contractorId: m.contractorId ? contractorIds.get(m.contractorId) : null,
          title: m.title,
          description: m.description,
          priority: m.priority,
          status: m.status,
          quoteAmount: m.quoteAmount,
          completedAt: m.completedAt,
        },
      })
    }
  }
  return { auth: { Authorization: `Bearer ${res.body.token}` }, userId }
}

const lineAt = (userId: number, row: number) =>
  prisma.bankTransaction.findFirstOrThrow({ where: { userId, details: { path: ['row'], equals: row } } })

const leaseOf = (userId: number, code: string) =>
  prisma.lease.findFirstOrThrow({ where: { property: { userId, code } }, orderBy: { startDate: 'desc' } })

async function septemberPayments(userId: number) {
  const rows = await prisma.payment.findMany({
    where: { lease: { property: { userId } }, dueDate: { gte: new Date('2026-09-01') } },
    include: { lease: { include: { property: true } } },
    orderBy: [{ dueDate: 'asc' }],
  })
  return rows.map((p) => ({ code: p.lease.property.code, due: p.dueDate.toISOString().slice(0, 10), status: p.status, paidDate: p.paidDate?.toISOString().slice(0, 10) ?? null }))
}

describe.skipIf(!hasDb)('reconciliation API', () => {
  let auth: { Authorization: string }
  let userId: number

  beforeAll(async () => {
    ;({ auth, userId } = await managerWithDemoPortfolio('reconciliation-api@example.com'))
  })

  it('needs a signed-in manager', async () => {
    expect((await request(app).get('/api/reconciliation/summary')).status).toBe(401)
    expect((await request(app).post('/api/reconciliation/import')).status).toBe(401)
  })

  it('is empty before a statement is imported', async () => {
    expect((await request(app).get('/api/reconciliation/summary').set(auth)).status).toBe(404)
    expect((await request(app).get('/api/reconciliation/transactions').set(auth)).body).toEqual([])
    expect((await request(app).get('/api/reconciliation/batches').set(auth)).body).toEqual([])
    expect((await request(app).get('/api/reconciliation/export.xlsx').set(auth)).status).toBe(404)
  })

  it('refuses uploads that are not a statement', async () => {
    const none = await request(app).post('/api/reconciliation/import').set(auth)
    expect(none.status).toBe(400)
    const pdf = await request(app).post('/api/reconciliation/import').set(auth).attach('file', Buffer.from('%PDF-1.4'), 'statement.pdf')
    expect(pdf.status).toBe(400)
    const junk = await request(app).post('/api/reconciliation/import').set(auth).attach('file', Buffer.from('hello,world\n1,2\n'), 'junk.csv')
    expect(junk.status).toBe(400)
    expect(junk.body.error).toMatch(/header/i)
  })

  it('imports the September statement and matches it', async () => {
    const res = await request(app).post('/api/reconciliation/import').set(auth).attach('file', Buffer.from(csv), '2026-09-statement.csv')
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ newLines: 50, skippedLines: 0, matched: 41, exceptions: 9, method: 'rules', alreadyImported: false })
    expect(res.body.batch).toMatch(/^2026-09-statement-[0-9a-f]{8}$/)
  })

  it('marks a week paid only when it is fully covered, with the date the money arrived', async () => {
    const payments = await septemberPayments(userId)
    expect(payments).toHaveLength(40)
    for (const p of payments) {
      const lease = truth.portfolio.leases.find((l) => l.code === p.code)!
      const covered = truth.rentPaidByWeek.afterAutomatic[p.code!][p.due]
      expect([p.code, p.due, p.status]).toEqual([p.code, p.due, covered === lease.weeklyRent ? 'paid' : 'pending'])
      if (p.status === 'paid') expect(p.paidDate).not.toBeNull()
      else expect(p.paidDate).toBeNull()
    }
    const fifita = payments.filter((p) => p.code === 'GLN22')
    expect(fifita.map((p) => p.paidDate)).toEqual(['2026-09-07', '2026-09-07', '2026-09-21', '2026-09-21'])
  })

  it('records one automatic run for every line matched without an exception', async () => {
    const runs = await prisma.automationRun.findMany({ where: { userId, automation: 'rent_reconciliation' } })
    expect(runs).toHaveLength(41)
    expect(new Set(runs.map((r) => r.outcome))).toEqual(new Set(['auto']))
    expect(runs.every((r) => /^bank:\d+$/.test(r.itemRef) && r.baselineMinutes === 3)).toBe(true)
  })

  it('importing the same statement again changes nothing', async () => {
    const before = await septemberPayments(userId)
    const again = await request(app).post('/api/reconciliation/import').set(auth).attach('file', Buffer.from(csv), '2026-09-statement.csv')
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ alreadyImported: true, newLines: 0, skippedLines: 50 })
    const renamed = await request(app).post('/api/reconciliation/import').set(auth).attach('file', Buffer.from(csv.replace(/\n/g, '\r\n')), 'copy of statement.csv')
    expect(renamed.body).toMatchObject({ alreadyImported: true, newLines: 0 })
    const demo = await request(app).post('/api/reconciliation/demo').set(auth)
    expect(demo.body).toMatchObject({ alreadyImported: true, newLines: 0 })
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(50)
    expect(await prisma.automationRun.count({ where: { userId } })).toBe(41)
    expect(await septemberPayments(userId)).toEqual(before)
  })

  it('summarises the statement: totals, matched share, exceptions by reason, arrears and credit', async () => {
    const res = await request(app).get('/api/reconciliation/summary').set(auth)
    expect(res.status).toBe(200)
    const s = res.body
    expect(s).toMatchObject({ lines: 50, moneyIn: truth.totals.moneyIn, moneyOut: truth.totals.moneyOut, period: { start: '2026-09-01', end: '2026-09-30' } })
    expect(s.matched).toEqual({ automatically: 41, afterReview: 0, total: 41, percent: 82 })
    expect(s.exceptions.open).toBe(9)
    const reasons = Object.fromEntries(s.exceptions.byReason.map((r: { reason: string; open: number }) => [r.reason, r.open]))
    expect(reasons).toEqual({ underpaid: 1, overpaid: 1, duplicate: 1, unknown_payer: 2, ambiguous: 1, payment_to_ended_lease: 1, no_matching_job: 1, amount_differs_from_quote: 1 })
    expect(s.arrears.tenants.map((a: { propertyCode: string; total: number }) => [a.propertyCode, a.total]).sort()).toEqual(
      truth.arrears.afterAutomatic.map((a) => [a.lease, a.amount]).sort(),
    )
    expect(s.arrears.total).toBe(1910)
    expect(s.credits.tenants).toEqual([expect.objectContaining({ propertyCode: 'MRB6', amount: 50 })])
    expect(s.method).toMatchObject({ label: 'Rules', rules: true })
  })

  it('lists lines by status and lists the imported statements', async () => {
    const open = await request(app).get('/api/reconciliation/transactions?status=exception').set(auth)
    expect(open.body.map((l: { exception: string }) => l.exception).sort()).toEqual(
      truth.lines.filter((l) => l.expected.exception).map((l) => l.expected.exception).sort(),
    )
    const first = open.body[0]
    expect(first).toHaveProperty('explanation')
    expect(first).toHaveProperty('suggestedAction')
    expect(first.engine.exception).toBe(first.exception)
    const matched = await request(app).get('/api/reconciliation/transactions?status=matched').set(auth)
    expect(matched.body).toHaveLength(41)
    expect(matched.body.find((l: { row: number }) => l.row === 4).allocations).toHaveLength(2)
    expect((await request(app).get('/api/reconciliation/transactions?status=nope').set(auth)).status).toBe(400)
    const batches = await request(app).get('/api/reconciliation/batches').set(auth)
    expect(batches.body).toEqual([expect.objectContaining({ fileName: '2026-09-statement.csv', periodStart: '2026-09-01', periodEnd: '2026-09-30', lines: 50, openExceptions: 9 })])
  })

  it('assigning the ambiguous line to Sophie Clarke pays her month and records the review time', async () => {
    const line = await lineAt(userId, rowOf('ambiguous'))
    const clarke = await leaseOf(userId, 'TAK9')
    const res = await request(app)
      .post(`/api/reconciliation/transactions/${line.id}/resolve`)
      .set(auth)
      .send({ decision: 'reassign', leaseId: clarke.id, note: 'Partner, confirmed by phone', reviewSeconds: 42 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ matchStatus: 'matched', matchType: 'rent', method: 'person', exception: 'ambiguous' })
    expect(res.body.lease.propertyCode).toBe('TAK9')
    expect(res.body.resolution).toMatchObject({ decision: 'reassign', note: 'Partner, confirmed by phone', reviewSeconds: 42, outcome: 'reviewed' })
    const tak9 = (await septemberPayments(userId)).filter((p) => p.code === 'TAK9')
    expect(tak9.every((p) => p.status === 'paid')).toBe(true)
    // The ledger is replayed in date order: this line now pays 21/09 and the later payment pays 28/09.
    expect(res.body.allocations.map((a: { dueDate: string }) => a.dueDate)).toEqual(['2026-09-21'])
    const run = await prisma.automationRun.findFirstOrThrow({ where: { itemRef: `bank:${line.id}` } })
    expect(run).toMatchObject({ outcome: 'reviewed', reviewSeconds: 42, automation: 'rent_reconciliation' })
    const summary = (await request(app).get('/api/reconciliation/summary').set(auth)).body
    expect(summary.arrears.tenants.map((a: { propertyCode: string }) => a.propertyCode).sort()).toEqual(['NLN11', 'ONE3'])
  })

  it('has nothing to accept on an unknown payer', async () => {
    const line = await lineAt(userId, rowOf('unknown_payer'))
    const res = await request(app).post(`/api/reconciliation/transactions/${line.id}/resolve`).set(auth).send({ decision: 'accept', reviewSeconds: 5 })
    expect(res.status).toBe(400)
  })

  it('accepting the duplicate leaves it out of the ledger', async () => {
    const line = await lineAt(userId, rowOf('duplicate'))
    const before = await septemberPayments(userId)
    const res = await request(app).post(`/api/reconciliation/transactions/${line.id}/resolve`).set(auth).send({ decision: 'accept', reviewSeconds: 8 })
    expect(res.body).toMatchObject({ matchStatus: 'ignored', allocations: [] })
    expect(await septemberPayments(userId)).toEqual(before)
  })

  it('accepting the underpayment keeps the part-payment and the arrears', async () => {
    const line = await lineAt(userId, rowOf('underpaid'))
    const res = await request(app).post(`/api/reconciliation/transactions/${line.id}/resolve`).set(auth).send({ decision: 'accept', reviewSeconds: 20 })
    expect(res.body).toMatchObject({ matchStatus: 'matched', exception: 'underpaid' })
    const summary = (await request(app).get('/api/reconciliation/summary').set(auth)).body
    expect(summary.arrears.tenants.find((a: { propertyCode: string }) => a.propertyCode === 'ONE3').total).toBe(50)
  })

  it("assigning the relative's payment to Mele Fifita holds it as credit", async () => {
    const line = await lineAt(userId, rowOf('unknown_payer', 1))
    const fifita = await leaseOf(userId, 'GLN22')
    const res = await request(app).post(`/api/reconciliation/transactions/${line.id}/resolve`).set(auth).send({ decision: 'reassign', leaseId: fifita.id, reviewSeconds: 65 })
    expect(res.body).toMatchObject({ matchStatus: 'matched', credit: 610 })
    const summary = (await request(app).get('/api/reconciliation/summary').set(auth)).body
    expect(summary.credits.tenants.map((c: { propertyCode: string; amount: number }) => [c.propertyCode, c.amount]).sort()).toEqual([
      ['GLN22', 610],
      ['MRB6', 50],
    ])
  })

  it('leaving out the misdirected payment is a review, not a correction', async () => {
    const line = await lineAt(userId, rowOf('unknown_payer'))
    const res = await request(app).post(`/api/reconciliation/transactions/${line.id}/resolve`).set(auth).send({ decision: 'ignore', note: 'Not ours: returned to sender', reviewSeconds: 30 })
    expect(res.body.matchStatus).toBe('ignored')
    expect((await prisma.automationRun.findFirstOrThrow({ where: { itemRef: `bank:${line.id}` } })).outcome).toBe('reviewed')
  })

  it('moving a matched payment to a different job counts as a correction', async () => {
    const line = await lineAt(userId, rowOf('amount_differs_from_quote'))
    const other = await prisma.maintenanceRequest.findFirstOrThrow({ where: { property: { userId, code: 'MRB6' } } })
    const res = await request(app).post(`/api/reconciliation/transactions/${line.id}/resolve`).set(auth).send({ decision: 'reassign', jobId: other.id, reviewSeconds: 12 })
    expect(res.body.job.id).toBe(other.id)
    expect((await prisma.automationRun.findFirstOrThrow({ where: { itemRef: `bank:${line.id}` } })).outcome).toBe('corrected')
  })

  it('checks every decision', async () => {
    const line = await lineAt(userId, rowOf('overpaid'))
    const url = `/api/reconciliation/transactions/${line.id}/resolve`
    expect((await request(app).post(url).set(auth).send({ decision: 'accept' })).status).toBe(400)
    expect((await request(app).post(url).set(auth).send({ decision: 'maybe', reviewSeconds: 1 })).status).toBe(400)
    expect((await request(app).post(url).set(auth).send({ decision: 'reassign', reviewSeconds: 1 })).status).toBe(400)
    expect((await request(app).post('/api/reconciliation/transactions/999999/resolve').set(auth).send({ decision: 'ignore', reviewSeconds: 1 })).status).toBe(404)
    const demo = await demoAuth()
    expect((await request(app).post(url).set(demo).send({ decision: 'ignore', reviewSeconds: 1 })).status).toBe(404)
    const lee = await leaseOf(userId, 'MRB6')
    const outgoing = await lineAt(userId, truth.lines.find((l) => l.case === 'transfer')!.row)
    const rentOut = await request(app).post(`/api/reconciliation/transactions/${outgoing.id}/resolve`).set(auth).send({ decision: 'reassign', leaseId: lee.id, reviewSeconds: 1 })
    expect(rentOut.status).toBe(400)
  })

  it('exports the workbook: summary, exceptions with an empty Decision column, matched lines and arrears', async () => {
    const res = await request(app)
      .get('/api/reconciliation/export.xlsx')
      .set(auth)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', (c: Buffer) => chunks.push(c))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
    expect(res.headers['content-disposition']).toMatch(/reconciliation-2026-09-statement-[0-9a-f]{8}\.xlsx/)

    const book = new ExcelJS.Workbook()
    await book.xlsx.load(res.body as unknown as ExcelJS.Buffer)
    expect(book.worksheets.map((w) => w.name)).toEqual(['Summary', 'Exceptions', 'Matched', 'Arrears'])

    const summary = book.getWorksheet('Summary')!
    const values = summary.getSheetValues().flat().map(String)
    expect(values).toContain('Key figures')
    expect(values).toContain('Exceptions by reason')

    const exceptions = book.getWorksheet('Exceptions')!
    const header = (exceptions.getRow(1).values as unknown[]).slice(1)
    expect(header).toContain('Decision')
    expect(header).toContain('Suggested action')
    expect(exceptions.rowCount).toBe(1 + 9)
    const decision = header.indexOf('Decision') + 1
    for (let r = 2; r <= exceptions.rowCount; r++) expect(exceptions.getCell(r, decision).value ?? '').toBe('')
    expect(exceptions.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(exceptions.autoFilter).toBeTruthy()
    expect(exceptions.getCell(2, header.indexOf('Amount') + 1).numFmt).toContain('NZ$')
    expect(exceptions.getCell(2, header.indexOf('Date') + 1).value).toBeInstanceOf(Date)

    const matched = book.getWorksheet('Matched')!
    const matchedLines = await prisma.bankTransaction.count({ where: { userId, matchStatus: 'matched' } })
    expect(matched.rowCount).toBe(1 + matchedLines)
    expect(matched.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })

    const arrears = book.getWorksheet('Arrears')!
    const last = arrears.getRow(arrears.rowCount)
    expect(String(last.getCell(1).value)).toMatch(/^Total/)
    expect((last.getCell(7).value as { result: number }).result).toBe(1130)
  })

  it('a statement that overlaps an earlier one only adds the new lines', async () => {
    const [header, ...rows] = csv.trim().split('\n')
    const october = [header, ...rows.slice(-3), '01/10/2026,-5.00,,MONTHLY A/C FEE,,,Bank Fee'].join('\n')
    const res = await request(app).post('/api/reconciliation/import').set(auth).attach('file', Buffer.from(october), 'october.csv')
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ newLines: 1, skippedLines: 3, matched: 1, exceptions: 0 })
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(51)
  })
})

describe.skipIf(!hasDb)('reconciliation model suggestions', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
    vi.restoreAllMocks()
  })

  it('asks only about unknown and ambiguous lines, stores the answer as a suggestion and applies nothing', async () => {
    const { userId } = await managerWithDemoPortfolio('reconciliation-ai@example.com')
    Object.assign(process.env, { AI_API_KEY: 'test-key', AI_DRIVER: '', AI_MIN_GAP_MS: '0', AI_CACHE_DIR: mkdtempSync(join(tmpdir(), 'recon-ai-')) })
    const answer = { tenancy: 'TAK9', category: 'rent', confidence: 0.8, reason: 'The same payer used the TAK9 reference on 07/09 and 14/09.' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 900, completion_tokens: 40 } })),
    )

    const result = await importStatement(userId, '2026-09-statement.csv', csv)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ method: 'rules+model', suggestions: 3, exceptions: 9 })

    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(sent.response_format.type).toBe('json_schema')
    expect(sent.messages[1].content).toContain('paymentsAlreadyMatchedThisStatement')

    const ambiguous = await lineAt(userId, rowOf('ambiguous'))
    const clarke = await leaseOf(userId, 'TAK9')
    expect(ambiguous.matchStatus).toBe('exception')
    expect(ambiguous.aiSuggestion).toMatchObject({ status: 'ok', tenancy: 'TAK9', leaseId: clarke.id, cached: false })
    const tak9 = (await septemberPayments(userId)).filter((p) => p.code === 'TAK9')
    expect(tak9.find((p) => p.due === '2026-09-28')?.status).toBe('pending')
    const lines = await prisma.bankTransaction.findMany({ where: { userId } })
    expect(lines.filter((l) => l.aiSuggestion !== null).map((l) => l.exception).sort()).toEqual(['ambiguous', 'unknown_payer', 'unknown_payer'])
  })
})

describe.skipIf(!hasDb)('the demo data and the ground truth agree', () => {
  it('has the tenancies, rents, references and jobs the statement was generated from', async () => {
    const demo = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@example.com' } })
    const leases = await prisma.lease.findMany({ where: { property: { userId: demo.id } }, include: { property: true, tenant: true } })
    const seeded = leases
      .map((l) => [l.property.code, `${l.tenant.firstName} ${l.tenant.lastName}`, l.weeklyRent, l.rentReference, l.status, l.endDate?.toISOString().slice(0, 10) ?? null])
      .sort()
    const expected = truth.portfolio.leases
      .map((l) => [l.code, `${l.tenant.firstName} ${l.tenant.lastName}`, l.weeklyRent, l.rentReference, l.status, l.endDate])
      .sort()
    expect(seeded).toEqual(expected)
    const jobs = await prisma.maintenanceRequest.findMany({ where: { property: { userId: demo.id } }, include: { property: true, contractor: true } })
    expect(jobs.map((j) => [j.property.code, j.contractor?.name, j.title, j.quoteAmount]).sort()).toEqual(
      truth.portfolio.jobs.map((j) => [j.property, j.contractor, j.title, j.quoteAmount]).sort(),
    )
  })
})
