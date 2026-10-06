// The three extraction methods behind one interface, all followed by the same business validation:
// - rules: regular expressions and heuristics;
// - llm: one structured-output model call, with the model's own confidence per field;
// - llm+validation: the model's answer checked by zod and the business rules, ONE repair call listing any problems,
//   then field confidence from the checks: high = passed and agrees with the rules (where the rules found a value),
//   medium = passed and the rules found nothing to compare, low = disagreement with the rules or a failed check.
import { sameFieldValue } from './compare'
import { modelExtract, modelRepair, type ModelAnswer, type ModelCall } from './model'
import { detectKind, extractInvoiceRules, extractLeaseRules } from './rules'
import { valueSchemas } from './schema'
import {
  fieldNames,
  isAlarm,
  type Confidence,
  type DocumentKind,
  type ExtractedField,
  type FieldSource,
  type Fields,
  type Issue,
  type Links,
  type Method,
} from './types'
import { FIELD_LABELS, validate, type ReferenceData } from './validate'

export interface ModelUsage {
  calls: number
  live: number
  cached: number
  /** Sum of the calls' latency (for cached replies, the latency recorded when they were made). */
  latencyMs: number
  repaired: boolean
}

export interface Extraction {
  kind: DocumentKind
  method: Method
  values: Fields
  extracted: Record<string, ExtractedField>
  issues: Issue[]
  links: Links
  model: ModelUsage
}

export interface MethodInput {
  text: string
  kind: DocumentKind
  ref: ReferenceData
}

export interface ExtractionMethod {
  name: Method
  run(input: MethodInput): Promise<Extraction>
}

const noModel = (): ModelUsage => ({ calls: 0, live: 0, cached: 0, latencyMs: 0, repaired: false })
const track = (usage: ModelUsage, call: ModelCall) => {
  usage.calls++
  if (call.cached) usage.cached++
  else usage.live++
  usage.latencyMs += call.latencyMs
}

export function rulesFields(kind: DocumentKind, text: string, ref: ReferenceData): Fields {
  return kind === 'invoice'
    ? extractInvoiceRules(text, { knownSuppliers: ref.contractors.map((c) => c.name) })
    : extractLeaseRules(text)
}

/** Checks the model's values against the field schemas; a value that fails becomes null plus an issue. */
export function checkModelAnswer(kind: DocumentKind, answer: ModelAnswer): { values: Fields; confidence: Record<string, Confidence>; issues: Issue[] } {
  const schemas = valueSchemas(kind)
  const values: Record<string, unknown> = {}
  const confidence: Record<string, Confidence> = {}
  const issues: Issue[] = []
  for (const name of fieldNames(kind)) {
    let raw = answer[name]?.value ?? null
    if (raw === '' || raw === 'null' || raw === 'N/A') raw = null
    if (name === 'endDate' && typeof raw === 'string' && /periodic/i.test(raw)) raw = 'periodic'
    if (name === 'rentFrequency' && typeof raw === 'string') raw = raw.toLowerCase()
    const parsed = schemas[name].safeParse(raw)
    if (parsed.success) {
      values[name] = parsed.data ?? null
      confidence[name] = answer[name]?.confidence ?? 'medium'
    } else {
      values[name] = null
      confidence[name] = 'low'
      issues.push({
        code: 'invalid_value',
        field: name,
        fields: [name],
        severity: 'error',
        message: `The ${FIELD_LABELS[name]} read from the document (${JSON.stringify(raw)}) ${parsed.error.issues[0]?.message ?? 'is not valid'}.`,
      })
    }
  }
  return { values: values as unknown as Fields, confidence, issues }
}

const fieldsOf = (values: Fields) => values as unknown as Record<string, unknown>

function build(
  kind: DocumentKind,
  method: Method,
  values: Fields,
  issues: Issue[],
  links: Links,
  confidenceOf: (name: string) => Confidence,
  sourceOf: (name: string) => FieldSource,
  model: ModelUsage,
): Extraction {
  const extracted: Record<string, ExtractedField> = {}
  for (const name of fieldNames(kind)) {
    extracted[name] = { value: fieldsOf(values)[name] ?? null, confidence: confidenceOf(name), source: sourceOf(name) }
  }
  return { kind, method, values, extracted, issues, links, model }
}

const doubted = (issues: Issue[]) => new Set(issues.filter(isAlarm).flatMap((i) => i.fields))

export const rulesMethod: ExtractionMethod = {
  name: 'rules',
  async run({ text, kind, ref }) {
    const values = rulesFields(kind, text, ref)
    const { issues, links } = validate(kind, values, ref)
    const low = doubted(issues)
    return build(
      kind,
      'rules',
      values,
      issues,
      links,
      (name) => (fieldsOf(values)[name] === null || low.has(name) ? 'low' : 'medium'),
      () => 'rules',
      noModel(),
    )
  },
}

export const llmMethod: ExtractionMethod = {
  name: 'llm',
  async run({ text, kind, ref }) {
    const usage = noModel()
    const call = await modelExtract(kind, text)
    track(usage, call)
    const checked = checkModelAnswer(kind, call.answer)
    const { issues, links } = validate(kind, checked.values, ref)
    return build(
      kind,
      'llm',
      checked.values,
      [...checked.issues, ...issues],
      links,
      (name) => checked.confidence[name],
      () => 'llm',
      usage,
    )
  },
}

export const llmValidationMethod: ExtractionMethod = {
  name: 'llm+validation',
  async run({ text, kind, ref }) {
    const usage = noModel()
    const rules = fieldsOf(rulesFields(kind, text, ref))

    const first = await modelExtract(kind, text)
    track(usage, first)
    let checked = checkModelAnswer(kind, first.answer)
    let result = validate(kind, checked.values, ref)
    let issues = [...checked.issues, ...result.issues]
    const firstValues = fieldsOf(checked.values)

    if (issues.some(isAlarm)) {
      const repair = await modelRepair(kind, text, first, issues.filter(isAlarm))
      track(usage, repair)
      usage.repaired = true
      checked = checkModelAnswer(kind, repair.answer)
      result = validate(kind, checked.values, ref)
      issues = [...checked.issues, ...result.issues]
    }

    const values = fieldsOf(checked.values)
    const low = doubted(issues)
    const confidence = (name: string): Confidence => {
      if (low.has(name)) return 'low'
      const fromRules = rules[name]
      if (fromRules === null || fromRules === undefined || (Array.isArray(fromRules) && fromRules.length === 0)) return 'medium'
      return sameFieldValue(name, fromRules, values[name]) ? 'high' : 'low'
    }
    const source = (name: string): FieldSource =>
      usage.repaired && !sameFieldValue(name, firstValues[name], values[name]) ? 'llm-repair' : 'llm'
    return build(kind, 'llm+validation', checked.values, issues, result.links, confidence, source, usage)
  },
}

export const METHODS: Record<Method, ExtractionMethod> = {
  rules: rulesMethod,
  llm: llmMethod,
  'llm+validation': llmValidationMethod,
}

/** Detects the kind (unless given) and runs one method. Model errors (quota, network) propagate to the caller. */
export function extractDocument(text: string, method: Method, ref: ReferenceData, kind: DocumentKind = detectKind(text)) {
  return METHODS[method].run({ text, kind, ref })
}
