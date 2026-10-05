import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { loadTasks } from '../scripts/discovery-backlog'
import { BASELINE_MINUTES } from '../src/lib/automation'
import { prisma } from '../src/lib/prisma'
import { summarise } from '../src/reports/hours'
import { app, demoAuth, hasDb } from './helpers'

describe('hours returned: the method', () => {
  it('credits baseline minutes only for used work and subtracts every minute of review', () => {
    const { rows, totals } = summarise([
      { automation: 'invoice_extraction', baselineMinutes: 12, reviewSeconds: 60, outcome: 'reviewed' },
      { automation: 'invoice_extraction', baselineMinutes: 12, reviewSeconds: 120, outcome: 'corrected' },
      { automation: 'invoice_extraction', baselineMinutes: 12, reviewSeconds: 90, outcome: 'rejected' },
      { automation: 'inbox_triage', baselineMinutes: 6, reviewSeconds: 0, outcome: 'auto' },
    ])
    const invoices = rows.find((r) => r.automation === 'invoice_extraction')!
    // credit 24 minutes (two used), review 4.5 minutes (all three) -> 19.5 minutes
    expect(invoices.baselineHours).toBe(0.4)
    expect(invoices.hoursReturned).toBe(0.3)
    expect(invoices.outcomes).toEqual({ reviewed: 1, corrected: 1, rejected: 1 })
    expect(totals.items).toBe(4)
  })

  it('uses the same minutes per item as the discovery timings', () => {
    const timed = Object.fromEntries(
      loadTasks()
        .filter((t) => t.automationKey)
        .map((t) => [t.automationKey, t.minutesPerItem]),
    )
    expect(timed).toEqual(BASELINE_MINUTES)
  })
})

describe.skipIf(!hasDb)('hours returned: API', () => {
  it('reports a month from the automation runs, with the method and a CSV export', async () => {
    const auth = await demoAuth()
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@example.com' } })
    await prisma.automationRun.createMany({
      data: [
        { userId: user.id, automation: 'rent_reconciliation', itemRef: 'test:1', baselineMinutes: 3, outcome: 'auto', createdAt: new Date('2026-07-10') },
        { userId: user.id, automation: 'rent_reconciliation', itemRef: 'test:2', baselineMinutes: 3, outcome: 'reviewed', reviewSeconds: 60, createdAt: new Date('2026-07-11') },
      ],
    })
    const res = await request(app).get('/api/reports/hours?month=2026-07').set(auth)
    expect(res.status).toBe(200)
    expect(res.body.rows[0]).toMatchObject({ automation: 'rent_reconciliation', items: 2, hoursReturned: 0.1 })
    expect(res.body.method.baselineMinutes.rent_reconciliation).toBe(3)

    const csv = await request(app).get('/api/reports/hours.csv?month=2026-07').set(auth)
    expect(csv.text).toContain('Rent reconciliation,2,3,0.1,0,0.1')

    const bad = await request(app).get('/api/reports/hours?month=July').set(auth)
    expect(bad.status).toBe(400)
  })
})
