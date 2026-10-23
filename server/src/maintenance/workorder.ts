// Contractor suggestion and the draft work order. The suggestion ranks the company's contractors by trade,
// availability and past similar jobs; the budget band comes from what similar completed jobs cost.
import { CATEGORY_LABELS, SAFETY_LABELS, TRADES_FOR, type BudgetBand, type Category, type ContractorSuggestion, type TriageOutcome, type WorkOrder } from './types'

export interface ContractorRow {
  id: number
  name: string
  trade: string
  available: boolean
  availableFrom: Date | null
  notes: string | null
}

export interface PastJob {
  contractorId: number | null
  category: string | null
  cost: number | null
  quoteAmount: number | null
  status: string
}

const round10 = (n: number) => Math.round(n / 10) * 10

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

const jobCost = (j: PastJob) => (j.status === 'completed' ? j.cost ?? j.quoteAmount : null)

function costsOf(jobs: PastJob[]): number[] {
  return jobs.map(jobCost).filter((c): c is number => typeof c === 'number' && c > 0).sort((a, b) => a - b)
}

/** The 25th to 75th percentile of similar completed jobs: same category first, then the same trades, then any job. */
export function budgetBand(category: Category, jobs: PastJob[], contractors: ContractorRow[], currency: string): BudgetBand | null {
  const tradeIds = new Set(contractors.filter((c) => TRADES_FOR[category].includes(c.trade)).map((c) => c.id))
  const tiers: [string, PastJob[]][] = [
    [`${CATEGORY_LABELS[category].toLowerCase()} jobs`, jobs.filter((j) => j.category === category)],
    [`jobs by ${TRADES_FOR[category].join(' or ').replace(/_/g, ' ')} contractors`, jobs.filter((j) => j.contractorId !== null && tradeIds.has(j.contractorId))],
    ['jobs of any kind', jobs],
  ]
  for (const [basis, pool] of tiers) {
    const costs = costsOf(pool)
    if (costs.length >= 2) {
      return { low: round10(quantile(costs, 0.25)), high: round10(quantile(costs, 0.75)), currency, basis: `${costs.length} completed ${basis}`, sampleSize: costs.length }
    }
  }
  return null
}

/** Ranks the contractors for a category: right trade, available now, and a record of similar jobs. */
export function suggestContractors(category: Category, contractors: ContractorRow[], jobs: PastJob[], now = new Date()): ContractorSuggestion[] {
  const trades = TRADES_FOR[category]
  return contractors
    .filter((c) => trades.includes(c.trade))
    .map((c) => {
      const own = jobs.filter((j) => j.contractorId === c.id)
      const similar = own.filter((j) => j.category === category)
      const costs = costsOf(similar.length ? similar : own)
      const backSoon = !c.available && c.availableFrom !== null && c.availableFrom.getTime() - now.getTime() < 7 * 86_400_000
      const tradeRank = trades.indexOf(c.trade)
      const score = (trades.length - tradeRank) * 100 + (c.available ? 50 : backSoon ? 20 : 0) + Math.min(similar.length, 5) * 6 + Math.min(own.length, 5) * 2
      const why = [
        tradeRank === 0 ? `${c.trade.replace(/_/g, ' ')} is the right trade` : `${c.trade.replace(/_/g, ' ')} can cover it`,
        c.available ? 'available now' : c.availableFrom ? `back on ${c.availableFrom.toISOString().slice(0, 10)}` : 'not taking jobs',
        similar.length ? `${similar.length} similar job${similar.length > 1 ? 's' : ''} before` : own.length ? `${own.length} job${own.length > 1 ? 's' : ''} for us before` : 'no jobs for us yet',
        c.notes ? c.notes.toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(', ')
      return {
        id: c.id,
        name: c.name,
        trade: c.trade,
        available: c.available,
        availableFrom: c.availableFrom ? c.availableFrom.toISOString().slice(0, 10) : null,
        similarJobs: similar.length,
        typicalCost: costs.length >= 2 ? { low: round10(quantile(costs, 0.25)), high: round10(quantile(costs, 0.75)) } : null,
        score,
        why,
      }
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

export interface DraftInput {
  triage: TriageOutcome
  property: { code: string | null; address: string; suburb: string }
  tenant: { name: string; phone: string | null } | null
  contractors: ContractorRow[]
  jobs: PastJob[]
  currency: string
  now?: Date
}

/** The draft work order: scope, access notes, safety notes, the budget band and the suggested contractor. */
export function draftWorkOrder(input: DraftInput): WorkOrder {
  const { triage } = input
  const suggestions = suggestContractors(triage.category, input.contractors, input.jobs, input.now)
  const where = `${input.property.address}, ${input.property.suburb}${input.property.code ? ` (${input.property.code})` : ''}`
  const access = triage.accessNotes
    ? `Tenant says: ${triage.accessNotes}.${input.tenant?.phone ? ` Tenant: ${input.tenant.name}, ${input.tenant.phone}.` : ''}`
    : input.tenant
      ? `Arrange access with the tenant, ${input.tenant.name}${input.tenant.phone ? ` on ${input.tenant.phone}` : ''}.`
      : 'Arrange access with the tenant before attending.'
  const safetyNotes = triage.safety.map((s) => SAFETY_LABELS[s])
  if (triage.safety.includes('gas')) safetyNotes.push('Tell the tenant: open windows, do not use switches or flames, leave the property if the smell is strong, and call the gas emergency line.')
  if (triage.safety.includes('electrical')) safetyNotes.push('Tell the tenant: switch the circuit off at the board and do not use the fitting until it is checked.')
  if (triage.safety.includes('flooding')) safetyNotes.push('Tell the tenant: turn the water off at the mains (toby/stopcock) and keep clear of water near electrics.')
  if (triage.safety.includes('security')) safetyNotes.push('Same-day attendance: the home must be secured before tonight.')
  return {
    title: triage.summary,
    scope: `${where}. ${triage.scope}`,
    accessNotes: access,
    safetyNotes,
    urgency: triage.urgency,
    budget: budgetBand(triage.category, input.jobs, input.contractors, input.currency),
    contractor: suggestions[0] ?? null,
    alternatives: suggestions.slice(1, 3),
    status: 'draft',
    approvedBy: null,
  }
}
