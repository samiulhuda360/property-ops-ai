// The hours-returned report: how much manual time the automations saved in a month, with the method shown.
//
// For every item an automation handled (one AutomationRun row):
//   credit  = the task's baseline minutes when the automation's work was used (outcome auto, reviewed or corrected),
//             0 when it was rejected or failed (a person did the task by hand anyway);
//   cost    = the minutes a person spent reviewing it (measured in the app, from opening the item to deciding).
//   minutes returned = credit - cost.
import { prisma } from '../lib/prisma'
import { BASELINE_MINUTES, type Automation } from '../lib/automation'

const USED = new Set(['auto', 'reviewed', 'corrected'])

export const AUTOMATION_LABELS: Record<Automation, string> = {
  inbox_triage: 'Tenant inbox triage',
  invoice_extraction: 'Supplier invoices',
  rent_reconciliation: 'Rent reconciliation',
  lease_extraction: 'Lease summaries',
}

export interface RunInput {
  automation: string
  baselineMinutes: number
  reviewSeconds: number
  outcome: string
}

export interface HoursRow {
  automation: string
  label: string
  items: number
  outcomes: Record<string, number>
  baselineMinutesPerItem: number
  baselineHours: number
  reviewHours: number
  hoursReturned: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Pure calculation, so the method can be tested without a database. */
export function summarise(runs: RunInput[]): { rows: HoursRow[]; totals: Omit<HoursRow, 'automation' | 'label' | 'baselineMinutesPerItem' | 'outcomes'> } {
  const byAutomation = new Map<string, RunInput[]>()
  for (const run of runs) byAutomation.set(run.automation, [...(byAutomation.get(run.automation) ?? []), run])

  const rows: HoursRow[] = [...byAutomation.entries()].map(([automation, items]) => {
    const credit = items.reduce((sum, r) => sum + (USED.has(r.outcome) ? r.baselineMinutes : 0), 0)
    const review = items.reduce((sum, r) => sum + r.reviewSeconds / 60, 0)
    const outcomes: Record<string, number> = {}
    for (const r of items) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1
    return {
      automation,
      label: AUTOMATION_LABELS[automation as Automation] ?? automation,
      items: items.length,
      outcomes,
      baselineMinutesPerItem: items[0]?.baselineMinutes ?? 0,
      baselineHours: round1(credit / 60),
      reviewHours: round1(review / 60),
      hoursReturned: round1((credit - review) / 60),
    }
  })
  rows.sort((a, b) => b.hoursReturned - a.hoursReturned)

  const totals = {
    items: rows.reduce((s, r) => s + r.items, 0),
    baselineHours: round1(rows.reduce((s, r) => s + r.baselineHours, 0)),
    reviewHours: round1(rows.reduce((s, r) => s + r.reviewHours, 0)),
    hoursReturned: round1(rows.reduce((s, r) => s + r.hoursReturned, 0)),
  }
  return { rows, totals }
}

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number)
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }
}

/** Months (YYYY-MM) that have automation runs, newest first. */
export async function monthsWithRuns(userId: number): Promise<string[]> {
  const runs = await prisma.automationRun.findMany({ where: { userId }, select: { createdAt: true } })
  const months = new Set(runs.map((r) => r.createdAt.toISOString().slice(0, 7)))
  return [...months].sort().reverse()
}

export async function hoursReport(userId: number, month: string) {
  const { start, end } = monthRange(month)
  const runs = await prisma.automationRun.findMany({
    where: { userId, createdAt: { gte: start, lt: end } },
    select: { automation: true, baselineMinutes: true, reviewSeconds: true, outcome: true },
  })
  const { rows, totals } = summarise(runs)
  return {
    month,
    rows,
    totals,
    method: {
      formula: 'hours returned = sum of baseline minutes for items whose automated work was used - minutes people spent reviewing',
      baselineMinutes: BASELINE_MINUTES,
      notes: [
        'Baseline minutes per item come from the discovery timings (discovery/task-timings.csv).',
        'Review time is measured in the app, from opening an item to approving, correcting or rejecting it.',
        'Rejected or failed items earn no credit: a person did that task by hand.',
      ],
    },
  }
}

/** Model usage for the month: calls, cache hits, failures, latency and tokens per feature. */
export async function aiUsage(month: string) {
  const { start, end } = monthRange(month)
  const calls = await prisma.aiCall.findMany({ where: { createdAt: { gte: start, lt: end } } })
  const features = new Map<string, typeof calls>()
  for (const c of calls) features.set(c.feature, [...(features.get(c.feature) ?? []), c])
  return [...features.entries()].map(([feature, list]) => {
    const live = list.filter((c) => !c.cached && !c.error).map((c) => c.latencyMs).sort((a, b) => a - b)
    return {
      feature,
      calls: list.length,
      cached: list.filter((c) => c.cached).length,
      failed: list.filter((c) => c.error).length,
      medianLatencyMs: live.length ? live[Math.floor(live.length / 2)] : null,
      inputTokens: list.reduce((s, c) => s + (c.inputTokens ?? 0), 0),
      outputTokens: list.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
    }
  })
}
