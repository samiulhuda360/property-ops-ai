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

export interface AiUsageRow {
  feature: string
  calls: number
  cached: number
  failed: number
  medianLatencyMs: number | null
  inputTokens: number
  outputTokens: number
}

export interface HoursReport {
  month: string
  months: string[]
  rows: HoursRow[]
  totals: { items: number; baselineHours: number; reviewHours: number; hoursReturned: number }
  method: { formula: string; baselineMinutes: Record<string, number>; notes: string[] }
  aiUsage: AiUsageRow[]
}
