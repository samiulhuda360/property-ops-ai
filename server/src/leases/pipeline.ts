// The three abstraction routes behind one interface, all followed by the same checks, the risk playbook and the
// charge schedule:
// - rules: labelled rows and clause patterns, country-aware;
// - llm: one structured-output model call with a quote and the model's own confidence per term;
// - hybrid: the model's answer checked against the rules and the business checks, ONE repair call listing any
//   problems, then confidence from the checks: high = passed and agrees with the rules, medium = passed with nothing
//   to compare (including a term the lease does not state), low = disagreement or a failed check. Low confidence
//   means "needs a person"; a required term that is missing fails a check and so is low.
import { scheduleCharges } from './charges'
import { sameTermValue } from './compare'
import { modelExtract, modelRepair, type ModelAnswer, type ModelCall } from './model'
import { findRisks } from './risks'
import { extractLeaseRules, rulesTerms, type RuleHits } from './rules'
import { locateQuote } from './text'
import {
  isAlarm,
  TERM_FIELDS,
  type Charge,
  type Confidence,
  type Country,
  type ExtractedTerm,
  type ExtractedTerms,
  type FieldSource,
  type Issue,
  type LeaseTerms,
  type LeaseType,
  type PageText,
  type RiskFinding,
  type Route,
  type TermField,
} from './types'
import { checkValues, validateTerms } from './validate'

export interface ModelUsage {
  calls: number
  live: number
  cached: number
  latencyMs: number
  inputTokens: number
  outputTokens: number
  repaired: boolean
}

export interface Abstraction {
  country: Country
  leaseType: LeaseType
  route: Route
  terms: LeaseTerms
  extracted: ExtractedTerms
  issues: Issue[]
  risks: RiskFinding[]
  charges: Charge[]
  model: ModelUsage
}

export interface RouteInput {
  pages: PageText[]
}

export interface AbstractionRoute {
  name: Route
  run(input: RouteInput): Promise<Abstraction>
}

const noModel = (): ModelUsage => ({ calls: 0, live: 0, cached: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, repaired: false })
const track = (usage: ModelUsage, call: ModelCall) => {
  usage.calls++
  if (call.cached) usage.cached++
  else usage.live++
  usage.latencyMs += call.latencyMs
  usage.inputTokens += call.inputTokens ?? 0
  usage.outputTokens += call.outputTokens ?? 0
}

const doubted = (issues: Issue[]) => new Set(issues.filter(isAlarm).flatMap((i) => i.fields))
const blank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

interface Where {
  page: number | null
  quote: string | null
}

function finish(
  country: Country,
  leaseType: LeaseType,
  route: Route,
  pages: PageText[],
  terms: LeaseTerms,
  issues: Issue[],
  where: (f: TermField) => Where,
  confidence: (f: TermField) => Confidence,
  source: (f: TermField) => FieldSource,
  model: ModelUsage,
): Abstraction {
  const extracted = {} as ExtractedTerms
  for (const f of TERM_FIELDS) {
    const value = (terms as unknown as Record<string, unknown>)[f] ?? null
    const c = confidence(f)
    const w = blank(value) ? { page: null, quote: null } : where(f)
    extracted[f] = { value, page: w.page, quote: w.quote, confidence: c, source: source(f), status: c === 'low' ? 'needs_person' : 'extracted' } satisfies ExtractedTerm
  }
  const risks = findRisks(terms, extracted, pages, leaseType)
  const charges = scheduleCharges(terms)
  return { country, leaseType, route, terms, extracted, issues, risks, charges, model }
}

/** The model's quote located in the pages; falls back to where the rules read the field. */
function whereFrom(pages: PageText[], answer: ModelAnswer, hits: RuleHits | null) {
  return (f: TermField): Where => {
    const located = locateQuote(pages, answer[f]?.quote)
    if (located) return located
    if (answer[f]?.quote) return { page: null, quote: answer[f]!.quote }
    return hits ? { page: hits[f].page, quote: hits[f].quote } : { page: null, quote: null }
  }
}

const valuesOf = (answer: ModelAnswer) => Object.fromEntries(TERM_FIELDS.map((f) => [f, answer[f]?.value ?? null]))

export const rulesRoute: AbstractionRoute = {
  name: 'rules',
  async run({ pages }) {
    const { country, leaseType, hits } = extractLeaseRules(pages)
    const checked = checkValues(rulesTerms(hits) as unknown as Record<string, unknown>)
    const issues = [...checked.issues, ...validateTerms(checked.values, country, leaseType)]
    const low = doubted(issues)
    const t = checked.values as unknown as Record<string, unknown>
    return finish(
      country,
      leaseType,
      'rules',
      pages,
      checked.values,
      issues,
      (f) => ({ page: hits[f].page, quote: hits[f].quote }),
      (f) => (low.has(f) ? 'low' : 'medium'),
      () => 'rules',
      noModel(),
    )
  },
}

export const llmRoute: AbstractionRoute = {
  name: 'llm',
  async run({ pages }) {
    const { country, leaseType } = extractLeaseRules(pages)
    const usage = noModel()
    const call = await modelExtract(pages, country, leaseType)
    track(usage, call)
    const checked = checkValues(valuesOf(call.answer))
    const issues = [...checked.issues, ...validateTerms(checked.values, country, leaseType)]
    const low = doubted(issues)
    return finish(
      country,
      leaseType,
      'llm',
      pages,
      checked.values,
      issues,
      whereFrom(pages, call.answer, null),
      (f) => (low.has(f) ? 'low' : (call.answer[f]?.confidence ?? 'medium')),
      () => 'llm',
      usage,
    )
  },
}

export const hybridRoute: AbstractionRoute = {
  name: 'hybrid',
  async run({ pages }) {
    const { country, leaseType, hits } = extractLeaseRules(pages)
    const rules = checkValues(rulesTerms(hits) as unknown as Record<string, unknown>).values as unknown as Record<string, unknown>
    const usage = noModel()

    // Merge: the model's value, the rules' value when the model has none; a disagreement is an issue for a person.
    const merge = (answer: ModelAnswer) => {
      const checked = checkValues(valuesOf(answer))
      const values = checked.values as unknown as Record<string, unknown>
      const source: Record<string, FieldSource> = {}
      const issues: Issue[] = [...checked.issues]
      for (const f of TERM_FIELDS) {
        source[f] = 'llm'
        if (blank(values[f]) && !blank(rules[f])) {
          values[f] = rules[f]
          source[f] = 'rules'
        } else if (!blank(values[f]) && !blank(rules[f]) && !sameTermValue(f, values[f], rules[f])) {
          issues.push({
            code: 'rules_disagree',
            field: f,
            fields: [f],
            severity: 'warning',
            message: `The model read ${JSON.stringify(values[f])} but the rules read ${JSON.stringify(rules[f])}.`,
          })
        }
      }
      const terms = values as unknown as LeaseTerms
      issues.push(...validateTerms(terms, country, leaseType))
      return { terms, source, issues }
    }

    const first = await modelExtract(pages, country, leaseType)
    track(usage, first)
    let answer = first.answer
    let merged = merge(answer)
    const firstValues = { ...(merged.terms as unknown as Record<string, unknown>) }

    if (merged.issues.some(isAlarm)) {
      const repair = await modelRepair(pages, country, leaseType, first, merged.issues.filter(isAlarm))
      track(usage, repair)
      usage.repaired = true
      answer = repair.answer
      merged = merge(answer)
    }

    const values = merged.terms as unknown as Record<string, unknown>
    const low = doubted(merged.issues)
    const confidence = (f: TermField): Confidence => {
      if (low.has(f)) return 'low'
      if (blank(values[f]) || blank(rules[f])) return 'medium'
      return 'high'
    }
    const source = (f: TermField): FieldSource =>
      merged.source[f] === 'rules' ? 'rules' : usage.repaired && !sameTermValue(f, firstValues[f], values[f]) ? 'llm-repair' : 'llm'
    const where = whereFrom(pages, answer, hits)
    return finish(
      country,
      leaseType,
      'hybrid',
      pages,
      merged.terms,
      merged.issues,
      (f) => (merged.source[f] === 'rules' ? { page: hits[f].page, quote: hits[f].quote } : where(f)),
      confidence,
      source,
      usage,
    )
  },
}

export const ROUTES: Record<Route, AbstractionRoute> = { rules: rulesRoute, llm: llmRoute, hybrid: hybridRoute }

/** Runs one route over the pages. Model errors (quota, network, replay miss) propagate to the caller. */
export function abstractLease(pages: PageText[], route: Route): Promise<Abstraction> {
  return ROUTES[route].run({ pages })
}
