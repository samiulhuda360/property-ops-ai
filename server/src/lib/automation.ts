import { prisma } from './prisma'

/**
 * Minutes each task takes by hand, per item, from the discovery timings (discovery/task-timings.csv).
 * The hours-returned report multiplies these by the items each automation handled, then subtracts the time people
 * spent reviewing the automation's work.
 */
export const BASELINE_MINUTES = {
  invoice_extraction: 12,
  lease_extraction: 25,
  rent_reconciliation: 3,
  inbox_triage: 6,
} as const

export type Automation = keyof typeof BASELINE_MINUTES
export type RunOutcome = 'auto' | 'reviewed' | 'corrected' | 'rejected' | 'failed'

/** Records one item an automation handled. Call it when the item is created, then update reviewSeconds on review. */
export async function recordRun(input: {
  userId: number
  automation: Automation
  itemRef: string
  outcome: RunOutcome
  reviewSeconds?: number
  at?: Date
}) {
  return prisma.automationRun.create({
    data: {
      userId: input.userId,
      automation: input.automation,
      itemRef: input.itemRef,
      outcome: input.outcome,
      reviewSeconds: input.reviewSeconds ?? 0,
      baselineMinutes: BASELINE_MINUTES[input.automation],
      ...(input.at ? { createdAt: input.at } : {}),
    },
  })
}

/** Adds review time (and a new outcome) to the run for an item, e.g. when a person approves a document. */
export async function recordReview(itemRef: string, reviewSeconds: number, outcome: RunOutcome) {
  const run = await prisma.automationRun.findFirst({ where: { itemRef }, orderBy: { id: 'desc' } })
  if (!run) return null
  return prisma.automationRun.update({
    where: { id: run.id },
    data: { reviewSeconds: run.reviewSeconds + Math.max(0, Math.round(reviewSeconds)), outcome },
  })
}
