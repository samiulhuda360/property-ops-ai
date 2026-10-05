// Optional model assist for the lines the rules couldn't place (unknown payer or ambiguous).
// The model sees the line, the tenancies and who has paid each one this month, and suggests a tenancy or a
// category with a reason. The answer is checked against the real tenancy list, stored as a suggestion and shown to
// a person. It is never applied automatically, and the rules work the same without it.
import { z } from 'zod'
import { aiConfig, aiEnabled, chat, type JsonSchema } from '../ai/llm'
import type { StatementLine } from './types'

export const SUGGESTION_CATEGORIES = ['rent', 'bond', 'refund', 'contractor', 'fee', 'transfer', 'other', 'unidentified'] as const

export const SUGGESTION_SCHEMA: JsonSchema = {
  name: 'bank_line_suggestion',
  schema: {
    type: 'object',
    properties: {
      tenancy: { type: 'string', description: 'Property code of the most likely tenancy, exactly as listed, or NONE' },
      category: { type: 'string', enum: [...SUGGESTION_CATEGORIES] },
      confidence: { type: 'number', description: 'From 0 to 1' },
      reason: { type: 'string', description: 'One or two sentences a property manager can check against the statement' },
    },
    required: ['tenancy', 'category', 'confidence', 'reason'],
  },
}

const SYSTEM = [
  'You help a property manager in New Zealand reconcile the trust account bank statement.',
  'The matching rules could not place one bank line. Suggest the most likely tenancy for it, or a category if it is not rent.',
  'Use only the tenancies listed. Answer NONE when the evidence does not point to one of them, and say why in the reason.',
  'Weigh the payer name, the reference text, the amount against each weekly rent, and who has paid each tenancy this month.',
  'A person reviews your suggestion before anything changes; nothing is applied automatically. Reply with JSON only.',
].join(' ')

export interface SuggestionTenancy {
  code: string
  tenant: string
  address: string
  weeklyRent: number
  rentReference: string | null
  status: string
  endDate: string | null
  /** Rent due by the end of the statement and not yet covered by money matched to the tenancy. */
  owingAtStatementEnd: number
  /** Money held on the tenancy beyond the rent due. */
  creditHeld: number
}

export interface SuggestionInput {
  line: StatementLine
  tenancies: SuggestionTenancy[]
  /** Lines already matched to tenancies in this statement: who paid, and with what reference. */
  payersSeen: { code: string; payer: string; reference: string; date: string; amount: number }[]
  rules: { exception: string; explanation: string; candidates: string[] }
}

export interface AiSuggestion {
  status: 'ok' | 'invalid' | 'failed'
  /** Property code of the suggested tenancy, or null for none. */
  tenancy: string | null
  leaseId: number | null
  category: string
  confidence: number
  reason: string
  model: string
  cached: boolean
  at: string
  error?: string
}

const reply = z.object({
  tenancy: z.string(),
  category: z.string(),
  confidence: z.number(),
  reason: z.string(),
})

export function buildPrompt(input: SuggestionInput): string {
  const { line } = input
  return JSON.stringify(
    {
      bankLine: {
        date: line.date,
        amount: line.amount,
        payee: line.payee,
        particulars: line.particulars,
        code: line.code,
        reference: line.reference,
        transactionType: line.tranType,
      },
      tenancies: input.tenancies,
      paymentsAlreadyMatchedThisStatement: input.payersSeen,
      whatTheRulesFound: input.rules,
    },
    null,
    2,
  )
}

/** Checks the model's answer against the real tenancy list; an unknown code is reported, never guessed. */
export function validateSuggestion(raw: unknown, codes: string[]): Omit<AiSuggestion, 'leaseId' | 'model' | 'cached' | 'at'> {
  const parsed = reply.safeParse(raw)
  if (!parsed.success) {
    return { status: 'invalid', tenancy: null, category: 'unidentified', confidence: 0, reason: '', error: 'The reply did not match the expected fields.' }
  }
  const tenancy = parsed.data.tenancy.trim().toUpperCase()
  const category = (SUGGESTION_CATEGORIES as readonly string[]).includes(parsed.data.category) ? parsed.data.category : 'other'
  const confidence = Math.min(1, Math.max(0, parsed.data.confidence))
  if (tenancy === 'NONE' || tenancy === '') {
    return { status: 'ok', tenancy: null, category, confidence, reason: parsed.data.reason }
  }
  if (!codes.includes(tenancy)) {
    return {
      status: 'invalid',
      tenancy: null,
      category,
      confidence: 0,
      reason: parsed.data.reason,
      error: `The model named "${parsed.data.tenancy}", which isn't one of the tenancies.`,
    }
  }
  return { status: 'ok', tenancy, category, confidence, reason: parsed.data.reason }
}

// Live calls are spaced out (2.5 s by default, AI_MIN_GAP_MS to change) because the model quota is shared;
// cached answers return at once.
const minGapMs = () => Number(process.env.AI_MIN_GAP_MS ?? 2500)
let lastLiveCall = 0
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function suggestForLine(input: SuggestionInput): Promise<Omit<AiSuggestion, 'leaseId'>> {
  const at = new Date().toISOString()
  const model = aiConfig().model
  if (!aiEnabled()) {
    return { status: 'failed', tenancy: null, category: 'unidentified', confidence: 0, reason: '', model, cached: false, at, error: 'AI is off.' }
  }
  const wait = lastLiveCall + minGapMs() - Date.now()
  if (wait > 0) await sleep(wait)
  try {
    const result = await chat({
      feature: 'rent_reconciliation',
      system: SYSTEM,
      user: buildPrompt(input),
      schema: SUGGESTION_SCHEMA,
      maxTokens: 400,
    })
    if (!result.cached) lastLiveCall = Date.now()
    const checked = validateSuggestion(result.json, input.tenancies.map((t) => t.code))
    return { ...checked, model: result.model, cached: result.cached, at }
  } catch (e) {
    lastLiveCall = Date.now()
    return {
      status: 'failed',
      tenancy: null,
      category: 'unidentified',
      confidence: 0,
      reason: '',
      model,
      cached: false,
      at,
      error: e instanceof Error ? e.message : 'Model call failed',
    }
  }
}
