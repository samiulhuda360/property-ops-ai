export type RiskBand = 'low' | 'medium' | 'high'
export type NextStep = 'none' | 'reminder' | 'call' | 'payment_plan'

export interface RiskReason {
  feature: string
  text: string
  weight: number
}

export interface TenantRisk {
  id: number
  tenantId: number
  leaseId: number
  scoredAt: string
  asOfMonth: string
  probability: number
  band: RiskBand
  reasons: RiskReason[]
  features: Record<string, number>
  nextStep: NextStep
  draft: string
  status: 'draft' | 'approved' | 'dismissed'
  modelVersion: string
  approvedAt: string | null
  reviewSeconds: number | null
  note: string | null
  tenant: { id: number; firstName: string; lastName: string; email: string; phone: string }
  lease: { id: number; weeklyRent: number; startDate: string; property: { id: number; code: string | null; address: string; suburb: string; city: string; marketRent: number | null } }
}

export interface RentMonthRow {
  id: number
  month: string
  dueDate: string
  rentDue: number
  paidAmount: number
  paidDate: string | null
  daysLate: number
  arrears30: boolean
}

export interface RiskModelInfo {
  version: string
  trainedAt: string
  features: string[]
  bands: { high: number; medium: number }
  training: { cutoffs: string[]; rows: number; positives: number }
  backtest: Record<string, number | string>
  nextSteps: Record<NextStep, string>
}
