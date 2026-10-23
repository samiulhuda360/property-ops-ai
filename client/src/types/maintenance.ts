export type Urgency = 'urgent' | 'high' | 'normal' | 'low'
export type SafetyFlag = 'gas' | 'electrical' | 'flooding' | 'security'

export interface Triage {
  category: string
  urgency: Urgency
  safety: SafetyFlag[]
  summary: string
  reasons: string[]
  scope: string
  accessNotes: string | null
  method: 'rules' | 'llm' | 'llm+rules'
  model: { calls: number; live: number; cached: number; latencyMs: number; error: string | null }
  sampleId?: string | null
  tenantId?: number | null
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

export interface SampleRequest {
  id: string
  split: 'dev' | 'heldout'
  company: string
  code: string
  tenant: string | null
  text: string
  photoNote: string | null
}

export interface TriageMethodInfo {
  method: 'rules' | 'llm+rules'
  aiEnabled: boolean
  model: string | null
  categories: { key: string; label: string }[]
  safety: Record<SafetyFlag, string>
}
