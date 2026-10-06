// The model path: one structured-output call that returns every field with a value and a confidence, and (for
// llm+validation) one repair call that lists what the checks found.
import { AiError, chat, type ChatResult } from '../ai/llm'
import { jsonSchema } from './schema'
import type { Confidence, DocumentKind, Issue } from './types'

export const FEATURE = 'documents'

export interface ModelField {
  value: unknown
  confidence: Confidence
}
export type ModelAnswer = Record<string, ModelField>

export interface ModelCall {
  answer: ModelAnswer
  raw: string
  cached: boolean
  latencyMs: number
}

const INVOICE_SYSTEM = `You read New Zealand supplier invoices for a residential property manager and return the fields as JSON.
For every field return {"value": ..., "confidence": "high" | "medium" | "low"}; the confidence says how sure you are that the value is exactly what the document shows.
Rules:
- Copy values as printed. Never correct the supplier's arithmetic, dates or numbers: if the GST or a total looks wrong, return what is printed.
- Use null when the document does not show a field.
- Dates as YYYY-MM-DD. NZ documents write the day first: 03/09/2026 is 3 September 2026.
- Money as a number in dollars without $ or commas: "$1,420.00" is 1420.
- supplierName: the business that issued the invoice, not the customer.
- supplierGstNumber: the supplier's GST number as printed, e.g. 123-456-789.
- supplierBankAccount: the bank account the supplier asks to be paid into, e.g. 12-3456-7890123-00.
- invoiceNumber: the invoice, bill or tax invoice number; not a policy, account, job or customer number.
- invoiceDate: the date the invoice or bill was issued; not a billing period, meter reading or completion date.
- dueDate: the date payment is due.
- propertyAddress: the address of the rental property the charge is for (job site, supply address or insured property); not the supplier's address and not the bill-to address.
- lineItems: each charge line before GST, without GST or total lines: description, quantity, unitAmount and amount. Use null for quantity or unitAmount when the line doesn't show them.
- subtotal: the total before GST; gst: the GST amount; total: the total including GST.`

const LEASE_SYSTEM = `You read tenancy summaries from a New Zealand residential property manager and return the fields as JSON.
For every field return {"value": ..., "confidence": "high" | "medium" | "low"}; the confidence says how sure you are that the value is exactly what the document shows.
Rules:
- Copy values as printed and use null when the document does not show a field.
- Dates as YYYY-MM-DD. NZ documents write the day first: 03/09/2026 is 3 September 2026.
- Money as a number in dollars without $ or commas.
- tenantNames: the full name of every tenant, as a list.
- propertyAddress: the address of the rented property.
- startDate: the date the tenancy started.
- endDate: the fixed-term end date (YYYY-MM-DD), or the text "periodic" when the tenancy is periodic and has no end date.
- weeklyRent: the rent for one week. If the rent is given per fortnight, divide it by 2; per calendar month, multiply by 12 and divide by 52.
- bond: the bond amount.
- rentFrequency: how often the rent is paid: "weekly", "fortnightly" or "monthly".
- petsAllowed: true when pets are allowed, false when they are not.
- maxOccupants: the maximum number of occupants.`

const system = (kind: DocumentKind) => (kind === 'invoice' ? INVOICE_SYSTEM : LEASE_SYSTEM)
const label = (kind: DocumentKind) => (kind === 'invoice' ? 'Invoice' : 'Tenancy summary')
const documentBlock = (kind: DocumentKind, text: string) => `${label(kind)} text:\n"""\n${text}\n"""`

// Live calls are spaced out (default 2.5 s) because the API quota is shared; cached replies are not delayed.
let lastLiveCall = 0
const spacingMs = () => Number(process.env.AI_MIN_SPACING_MS ?? 2500)
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
  for (const [key, raw] of Object.entries(json as Record<string, unknown>)) {
    // Accept both {value, confidence} and a bare value.
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
      const { value, confidence } = raw as { value: unknown; confidence?: unknown }
      answer[key] = { value, confidence: confidence === 'high' || confidence === 'low' ? confidence : 'medium' }
    } else {
      answer[key] = { value: raw, confidence: 'medium' }
    }
  }
  return answer
}

async function ask(kind: DocumentKind, user: string): Promise<ModelCall> {
  const result = await paced(() =>
    chat({ feature: FEATURE, system: system(kind), user, schema: jsonSchema(kind), temperature: 0, maxTokens: 2500 }),
  )
  return { answer: toAnswer(result.json), raw: result.text, cached: result.cached, latencyMs: result.latencyMs }
}

/** First pass: the document text in, every field with a confidence out. */
export function modelExtract(kind: DocumentKind, text: string): Promise<ModelCall> {
  return ask(kind, documentBlock(kind, text))
}

/** The one repair call: the same document, the first answer, and the problems the checks found. */
export function modelRepair(kind: DocumentKind, text: string, first: ModelCall, issues: Issue[]): Promise<ModelCall> {
  const values: Record<string, unknown> = {}
  for (const [k, f] of Object.entries(first.answer)) values[k] = f.value
  const user = [
    documentBlock(kind, text),
    `Your earlier answer (values only):\n${JSON.stringify(values)}`,
    `Automatic checks found these problems:\n${issues.map((i) => `- ${i.message}`).join('\n')}`,
    'Read the document again and return the full JSON. Correct any value you misread or put in the wrong field. ' +
      'If the document really prints a value that fails a check (for example a wrong GST amount, or an invoice number ' +
      'that repeats an earlier one), keep that value exactly as printed: a person reviews those problems.',
  ].join('\n\n')
  return ask(kind, user)
}
