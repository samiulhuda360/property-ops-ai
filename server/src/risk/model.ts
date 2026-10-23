// The shipped arrears model: logistic-regression weights exported by server/ml/arrears.py to data/risk/model.json.
// Scoring is a dot product, so the server needs no Python. Each score comes with the top reasons in plain words,
// a band, and a suggested next step drafted for a person to approve.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FEATURE_NAMES, type FeatureName, type Features } from './features'

export const MODEL_PATH = resolve(__dirname, '../../../data/risk/model.json')

export interface ArrearsModel {
  version: string
  trainedAt: string
  features: FeatureName[]
  mean: number[]
  scale: number[]
  coef: number[]
  intercept: number
  bands: { high: number; medium: number }
  training: { cutoffs: string[]; rows: number; positives: number }
  backtest: Record<string, number | string>
}

export type Band = 'low' | 'medium' | 'high'
export type NextStep = 'none' | 'reminder' | 'call' | 'payment_plan'

export interface Reason {
  feature: FeatureName
  text: string
  weight: number
}

export interface Score {
  probability: number
  band: Band
  reasons: Reason[]
  nextStep: NextStep
}

let cached: ArrearsModel | null = null

export function loadModel(path = MODEL_PATH): ArrearsModel {
  if (cached && path === MODEL_PATH) return cached
  if (!existsSync(path)) throw new Error(`No arrears model at ${path}. Run server/ml/arrears.py train.`)
  const model = JSON.parse(readFileSync(path, 'utf8')) as ArrearsModel
  for (const [i, f] of FEATURE_NAMES.entries()) {
    if (model.features[i] !== f) throw new Error(`model.json feature ${i} is ${model.features[i]}, expected ${f}.`)
  }
  if (path === MODEL_PATH) cached = model
  return model
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/** The probability of going 30+ days behind in the next three months. */
export function probability(model: ArrearsModel, f: Features): number {
  let z = model.intercept
  for (const [i, name] of model.features.entries()) z += model.coef[i] * ((f[name] - model.mean[i]) / model.scale[i])
  return sigmoid(z)
}

export const bandFor = (model: ArrearsModel, p: number): Band => (p >= model.bands.high ? 'high' : p >= model.bands.medium ? 'medium' : 'low')

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const money = (n: number, currency: string) => `${currency} ${Math.round(n).toLocaleString('en-NZ')}`

/** What each feature means for this tenant, in plain words, given the raw value and how many months of history exist. */
function describe(name: FeatureName, f: Features, ctx: { months: number; rentMonthly: number; currency: string }): string | null {
  const window6 = Math.min(6, ctx.months)
  const v = f[name]
  switch (name) {
    case 'late_share_6': {
      const late = Math.round(v * window6)
      return late ? `paid late ${late} of the last ${window6} months` : null
    }
    case 'avg_days_late_6':
      return v >= 1 ? `on average ${Math.round(v)} days late over the last ${window6} months` : null
    case 'late_trend':
      return v >= 2 ? `getting later: the last 3 months were about ${Math.round(v)} days later than the 3 before` : null
    case 'partial_count_6':
      return v ? `${plural(v, 'partial payment')} in the last ${window6} months` : null
    case 'missed_count_12':
      return v ? `${plural(v, 'month')} with no payment in the last 12` : null
    case 'max_days_late_12':
      return v >= 14 ? `one payment ${Math.round(v)} days late in the last 12 months` : null
    case 'prior_arrears':
      return v ? 'has been 30 or more days behind before' : null
    case 'tenancy_months':
      return v <= 6 ? `a new tenancy (${plural(Math.round(v), 'month')})` : null
    case 'rent_ratio':
      return v > 1.03 ? `rent is ${Math.round((v - 1) * 100)}% above the market rent` : null
    case 'balance_ratio':
      return v >= 0.1 ? `currently ${money(v * ctx.rentMonthly, ctx.currency)} behind (about ${v.toFixed(1)} months' rent)` : null
    default:
      return null
  }
}

/** Scores one tenancy: probability, band, the top three reasons and the suggested next step. */
export function score(model: ArrearsModel, f: Features, ctx: { months: number; rentMonthly: number; currency: string }): Score {
  const p = probability(model, f)
  const band = bandFor(model, p)
  const contributions = model.features
    .map((name, i) => ({ name, weight: model.coef[i] * ((f[name] - model.mean[i]) / model.scale[i]) }))
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight)
  const reasons: Reason[] = []
  for (const c of contributions) {
    const text = describe(c.name, f, ctx)
    if (text) reasons.push({ feature: c.name, text, weight: Math.round(c.weight * 1000) / 1000 })
    if (reasons.length === 3) break
  }
  if (!reasons.length) {
    reasons.push({ feature: 'late_share_6', text: f.late_share_6 === 0 ? `paid on time every month in the last ${Math.min(6, ctx.months)}` : 'no single reason stands out', weight: 0 })
  }
  const nextStep: NextStep = band === 'high' ? (f.balance_ratio >= 0.5 || f.missed_count_12 > 0 ? 'payment_plan' : 'call') : band === 'medium' ? 'reminder' : 'none'
  return { probability: p, band, reasons, nextStep }
}

export const NEXT_STEP_LABELS: Record<NextStep, string> = {
  none: 'No action',
  reminder: 'Send a reminder',
  call: 'Call the tenant',
  payment_plan: 'Offer a payment plan',
}

/** The draft message or call note for the suggested step: a person edits and approves it, nothing is sent from here. */
export function draftFor(step: NextStep, input: { firstName: string; address: string; company: string; behind: number; currency: string; reasons: Reason[] }): string {
  const behind = input.behind > 0 ? money(input.behind, input.currency) : null
  switch (step) {
    case 'reminder':
      return (
        `Hi ${input.firstName},\n\nA quick reminder about the rent for ${input.address}. ` +
        (behind ? `Our records show ${behind} outstanding. ` : 'A few recent payments arrived after the due date. ') +
        `If you think our records are wrong, or if something has changed, please reply or call us and we will sort it out together.\n\nKind regards,\n${input.company}`
      )
    case 'call':
      return (
        `Call note for ${input.firstName} (${input.address}).\n` +
        `Why: ${input.reasons.map((r) => r.text).join('; ')}.\n` +
        (behind ? `Outstanding: ${behind}.\n` : '') +
        `Ask: is anything making the rent hard to pay on time? Agree a date for the next payment and note it on the tenancy.`
      )
    case 'payment_plan':
      return (
        `Hi ${input.firstName},\n\nWe would like to help you catch up on the rent for ${input.address}` +
        (behind ? `, which is currently ${behind} behind` : '') +
        `. We can spread the amount over the next few weeks on top of the usual rent, or talk through other options. ` +
        `Please reply with a time that suits you for a short call, or tell us what you can manage each week.\n\nKind regards,\n${input.company}`
      )
    default:
      return 'No action suggested. Rent has been paid on time.'
  }
}
