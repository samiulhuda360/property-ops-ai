// The model route: one structured-output call that returns every term with a value, the sentence it was read from
// and a confidence; and (for the hybrid route) one repair call listing what the checks found. Replies are cached in
// data/leases/model-cache/, which is committed, so tests, CI and the demo replay them without a key.
import { resolve } from 'node:path'
import { AiError, chat, type ChatResult } from '../ai/llm'
import { FIELD_LABELS, TERM_FIELDS, type Confidence, type Country, type Issue, type LeaseType, type PageText, type TermField } from './types'

export const FEATURE = 'lease_abstraction'
export const MODEL_CACHE_DIR = resolve(__dirname, '../../../data/leases/model-cache')

export interface ModelTerm {
  value: unknown
  quote: string | null
  confidence: Confidence
}
export type ModelAnswer = Partial<Record<TermField, ModelTerm>>

export interface ModelCall {
  answer: ModelAnswer
  raw: string
  cached: boolean
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
}

const FIELD_GUIDE: Record<TermField, string> = {
  leaseRef: 'the lease, deed or agreement reference code printed on the document, e.g. ACM-NZ-C-01',
  landlord: 'the landlord or lessor (the party granting the lease); the agent only if no owner is named',
  tenant: 'the tenant or lessee; several tenants joined with "and"',
  guarantor: 'the guarantor or co-signer, if any',
  premises: 'the address of the premises as printed',
  commencementDate: 'the commencement or start date (YYYY-MM-DD)',
  expiryDate: 'the expiry or end date of the fixed term (YYYY-MM-DD)',
  termMonths: 'the length of the term in months (5 years = 60)',
  rentAmount: 'the rent for ONE payment period as a number (e.g. the monthly instalment, the weekly rent); never the annual figure when the rent is paid more often',
  rentFrequency: 'how often rent is paid: weekly, fortnightly, monthly, quarterly or annual',
  annualRent: 'the rent per year as a number: the annual rent if printed, otherwise rentAmount multiplied by the periods per year (52, 26, 12, 4, 1)',
  currency: 'NZD, AUD, GBP or USD',
  reviewMechanism: 'how the rent is reviewed or escalated: cpi (index-linked, CPI, RPI), fixed (a fixed percentage), market, or none',
  reviewPercent: 'the fixed percentage increase when the mechanism is fixed, as a number (3 for 3%)',
  reviewDates: 'every review or escalation date within the term as a list of YYYY-MM-DD; for "each anniversary" list the anniversaries inside the term',
  outgoingsBasis: 'who pays the outgoings / service charge / CAM / operating expenses of the building: tenant_pays (the tenant pays all of them), proportion (the tenant pays a share or proportion), or landlord_pays (a gross rent, or the landlord pays the rates, taxes and building insurance). A tenant paying only its own utilities (electricity, gas, water, internet) is landlord_pays, not proportion',
  outgoingsAnnual: 'the annual outgoings, service charge, CAM or operating expenses estimate as a number, when the tenant pays them',
  bondAmount: 'the bond, deposit, security deposit, rent deposit or bank guarantee amount as a number',
  breakNoticeMonths: 'the months of notice needed to terminate early under a break or early-termination clause (60 days = 2, 90 days = 3); null when there is no such right',
  breakDate: 'the earliest date the break or early termination can take effect (YYYY-MM-DD); null when there is no such right',
  renewalTerms: 'the number of renewal rights or options (0 when there is none)',
  renewalTermMonths: 'the length of each renewal term in months',
  permittedUse: 'the permitted use as printed',
  makeGood: 'the make good / reinstatement / restoration / yielding-up obligation: tenant_cost (tenant must strip out and reinstate at its own cost), fair_wear (return clean, fair wear and tear excepted), or none',
  insurance: 'who the lease obliges to insure: tenant (the tenant must insure the premises), landlord (the landlord insures the building; a remark that the tenant looks after or is responsible for its own contents or belongings does NOT make it both), or both (ONLY when the lease obliges the tenant to take out insurance too, e.g. public liability cover of a stated amount or insurance of its fit-out)',
}

export const SYSTEM = `You abstract commercial and residential leases from New Zealand, Australia, the United Kingdom and the United States and return the key terms as JSON.
For every field return {"value": ..., "quote": "...", "confidence": "high" | "medium" | "low"}.
- "quote" is the exact sentence or line of the lease the value was read from, copied verbatim (at most 300 characters). Use null when the value is inferred rather than printed.
- "confidence" says how sure you are that the value is exactly what the lease says.
Rules:
- Use null when the lease does not state a field. Never guess a party, date or amount.
- Dates as YYYY-MM-DD. New Zealand, Australian and British documents write the day first (01/11/2025 is 1 November 2025); American documents write the month first (11/15/2025 is November 15, 2025).
- Money as a number without currency symbols or thousands separators ("£10,500.00" is 10500). Amounts written in words are the same amount ("seven thousand dollars ($7,000.00)" is 7000).
- Vocabulary differs by country: outgoings (NZ, AU), service charge (UK) and CAM charges or operating expenses (US) are the same field; bond (NZ, AU), deposit or rent deposit (UK) and security deposit (US) are the same field; rent review (NZ, AU, UK) and rent escalation (US) are the same field; make good (NZ, AU), reinstatement or dilapidations (UK), restoration or yielding up (US) are the same field.
Fields:
${TERM_FIELDS.map((f) => `- ${f}: ${FIELD_GUIDE[f]}`).join('\n')}`

const termSchema = (valueType: Record<string, unknown>) => ({
  type: 'object',
  properties: { value: valueType, quote: { type: ['string', 'null'] }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['value', 'quote', 'confidence'],
})

const STRING = { type: ['string', 'null'] }
const NUMBER = { type: ['number', 'null'] }
const VALUE_TYPES: Record<TermField, Record<string, unknown>> = {
  leaseRef: STRING,
  landlord: STRING,
  tenant: STRING,
  guarantor: STRING,
  premises: STRING,
  commencementDate: STRING,
  expiryDate: STRING,
  termMonths: NUMBER,
  rentAmount: NUMBER,
  rentFrequency: { type: ['string', 'null'], enum: ['weekly', 'fortnightly', 'monthly', 'quarterly', 'annual', null] },
  annualRent: NUMBER,
  currency: { type: ['string', 'null'], enum: ['NZD', 'AUD', 'GBP', 'USD', null] },
  reviewMechanism: { type: ['string', 'null'], enum: ['cpi', 'fixed', 'market', 'none', null] },
  reviewPercent: NUMBER,
  reviewDates: { type: ['array', 'null'], items: { type: 'string' } },
  outgoingsBasis: { type: ['string', 'null'], enum: ['tenant_pays', 'proportion', 'landlord_pays', null] },
  outgoingsAnnual: NUMBER,
  bondAmount: NUMBER,
  breakNoticeMonths: NUMBER,
  breakDate: STRING,
  renewalTerms: NUMBER,
  renewalTermMonths: NUMBER,
  permittedUse: STRING,
  makeGood: { type: ['string', 'null'], enum: ['tenant_cost', 'fair_wear', 'none', null] },
  insurance: { type: ['string', 'null'], enum: ['tenant', 'landlord', 'both', null] },
}

export const JSON_SCHEMA = {
  name: 'lease_terms',
  schema: {
    type: 'object',
    properties: Object.fromEntries(TERM_FIELDS.map((f) => [f, termSchema(VALUE_TYPES[f])])),
    required: [...TERM_FIELDS],
  },
}

const documentBlock = (pages: PageText[], country: Country, leaseType: LeaseType) =>
  `Lease text (${leaseType}, ${country}), page by page:\n` + pages.map((p) => `[page ${p.num}]\n${p.text}`).join('\n\n')

// Live calls are spaced out because the API quota is shared; cached replies are not delayed.
let lastLiveCall = 0
const spacingMs = () => Number(process.env.AI_MIN_SPACING_MS ?? (Number(process.env.AI_MIN_INTERVAL ?? 0) * 1000 || 4500))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function paced<T>(call: () => Promise<ChatResult<T>>): Promise<ChatResult<T>> {
  const wait = lastLiveCall + spacingMs() - Date.now()
  if (wait > 0) await sleep(wait)
  const result = await call()
  if (!result.cached) lastLiveCall = Date.now()
  return result
}

function toAnswer(json: unknown): ModelAnswer {
  if (!json || typeof json !== 'object') throw new AiError('The model did not return a JSON object.')
  const answer: ModelAnswer = {}
  for (const f of TERM_FIELDS) {
    const raw = (json as Record<string, unknown>)[f]
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
      const { value, quote, confidence } = raw as { value: unknown; quote?: unknown; confidence?: unknown }
      answer[f] = {
        value: value ?? null,
        quote: typeof quote === 'string' && quote.trim() ? quote.trim().slice(0, 300) : null,
        confidence: confidence === 'high' || confidence === 'low' ? confidence : 'medium',
      }
    } else {
      answer[f] = { value: raw ?? null, quote: null, confidence: 'medium' }
    }
  }
  return answer
}

async function ask(user: string): Promise<ModelCall> {
  const result = await paced(() =>
    chat({ feature: FEATURE, system: SYSTEM, user, schema: JSON_SCHEMA, temperature: 0, maxTokens: 4000, cacheDir: MODEL_CACHE_DIR }),
  )
  return {
    answer: toAnswer(result.json),
    raw: result.text,
    cached: result.cached,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  }
}

/** First pass: the lease text in, every term with a quote and a confidence out. */
export function modelExtract(pages: PageText[], country: Country, leaseType: LeaseType): Promise<ModelCall> {
  return ask(documentBlock(pages, country, leaseType))
}

/** The one repair call: the same lease, the first answer, and the problems the checks found. */
export function modelRepair(pages: PageText[], country: Country, leaseType: LeaseType, first: ModelCall, issues: Issue[]): Promise<ModelCall> {
  const values: Record<string, unknown> = {}
  for (const [k, f] of Object.entries(first.answer)) values[k] = f.value
  const user = [
    documentBlock(pages, country, leaseType),
    `Your earlier answer (values only):\n${JSON.stringify(values)}`,
    `Automatic checks found these problems:\n${issues.map((i) => `- ${i.field ? `${FIELD_LABELS[i.field as TermField] ?? i.field}: ` : ''}${i.message}`).join('\n')}`,
    'Read the lease again and return the full JSON. Correct any value you misread or put in the wrong field. ' +
      'If the lease really says something that fails a check, keep it exactly as printed: a person reviews those problems.',
  ].join('\n\n')
  return ask(user)
}
