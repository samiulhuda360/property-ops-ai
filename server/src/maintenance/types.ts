// Shared types for maintenance triage: a tenant's repair request in, a category, an urgency, the safety flags,
// a contractor suggestion and a draft work order out. A person approves the work order; nothing is booked by the app.

export const CATEGORIES = ['plumbing', 'electrical', 'gas_heating', 'water_leak', 'security', 'pest', 'appliance', 'structural', 'general'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  gas_heating: 'Gas and heating',
  water_leak: 'Water leak or flooding',
  security: 'Locks and security',
  pest: 'Pests',
  appliance: 'Appliances',
  structural: 'Building and grounds',
  general: 'General repair',
}

export const URGENCIES = ['urgent', 'high', 'normal', 'low'] as const
export type Urgency = (typeof URGENCIES)[number]
const URGENCY_RANK: Record<Urgency, number> = { low: 0, normal: 1, high: 2, urgent: 3 }
export const maxUrgency = (a: Urgency, b: Urgency): Urgency => (URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b)

/** The urgency's job priority in the maintenance list. */
export const PRIORITY_FOR: Record<Urgency, 'urgent' | 'high' | 'medium' | 'low'> = { urgent: 'urgent', high: 'high', normal: 'medium', low: 'low' }

/** Safety cases that must always be urgent: a gas smell or leak, dangerous electrics, flooding, a home that can't be secured. */
export const SAFETY_FLAGS = ['gas', 'electrical', 'flooding', 'security'] as const
export type SafetyFlag = (typeof SAFETY_FLAGS)[number]

export const SAFETY_LABELS: Record<SafetyFlag, string> = {
  gas: 'Gas: possible leak',
  electrical: 'Electrical: risk of fire or shock',
  flooding: 'Water: flooding or water near electrics',
  security: 'Security: the home cannot be secured',
}

/** Which trades do each category, best first. */
export const TRADES_FOR: Record<Category, string[]> = {
  plumbing: ['plumbing'],
  electrical: ['electrical'],
  gas_heating: ['gas_heating', 'plumbing'],
  water_leak: ['plumbing', 'roofing'],
  security: ['locksmith', 'general'],
  pest: ['pest_control'],
  appliance: ['electrical', 'general'],
  structural: ['general', 'roofing'],
  general: ['general', 'cleaning', 'gardening'],
}

export type TriageMethod = 'rules' | 'llm' | 'llm+rules'

export interface RequestInput {
  text: string
  photoNote?: string | null
}

export interface TriageOutcome {
  category: Category
  urgency: Urgency
  safety: SafetyFlag[]
  summary: string
  /** Why: the keywords or the model's reasoning, in plain words. */
  reasons: string[]
  /** The scope of work in a tradesperson's words, for the work order. */
  scope: string
  /** Access details the tenant gave (times, keys, pets), or null. */
  accessNotes: string | null
  method: TriageMethod
  model: { calls: number; live: number; cached: number; latencyMs: number; error: string | null }
}

export interface ContractorSuggestion {
  id: number
  name: string
  trade: string
  available: boolean
  availableFrom: string | null
  similarJobs: number
  typicalCost: { low: number; high: number } | null
  score: number
  why: string
}

export interface BudgetBand {
  low: number
  high: number
  currency: string
  basis: string
  sampleSize: number
}

export interface WorkOrder {
  title: string
  scope: string
  accessNotes: string
  safetyNotes: string[]
  urgency: Urgency
  budget: BudgetBand | null
  contractor: ContractorSuggestion | null
  alternatives: ContractorSuggestion[]
  status: 'draft' | 'approved' | 'rejected'
  approvedBy?: { userId: number; at: string } | null
}
