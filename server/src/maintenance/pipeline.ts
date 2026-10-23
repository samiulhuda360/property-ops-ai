// Maintenance triage routes: rules only, the model only (evaluation), and the shipped combination, where the model
// classifies and writes the scope but the rules keep the safety net: a safety pattern always makes the request
// urgent, and the model's urgency can be raised by the rules, never lowered.
import { AiError, aiEnabled } from '../ai/llm'
import { callTriageModel } from './model'
import { triageByRules } from './rules'
import { maxUrgency, type RequestInput, type SafetyFlag, type TriageMethod, type TriageOutcome } from './types'

export const defaultMethod = (): TriageMethod => (aiEnabled() ? 'llm+rules' : 'rules')

export async function triageRequest(input: RequestInput, method: TriageMethod = defaultMethod()): Promise<TriageOutcome> {
  const rules = triageByRules(input)
  if (method === 'rules') return rules

  let call
  try {
    call = await callTriageModel(input)
  } catch (e) {
    if (!(e instanceof AiError)) throw e
    return { ...rules, reasons: [...rules.reasons, 'The model could not be reached, so the rules triaged this request.'], model: { ...rules.model, calls: 1, error: e.message } }
  }
  const m = call.output
  const modelStats = { calls: 1, live: call.cached ? 0 : 1, cached: call.cached ? 1 : 0, latencyMs: call.latencyMs, error: null }
  if (method === 'llm') {
    return { category: m.category, urgency: m.urgency, safety: m.safety, summary: m.summary, reasons: m.reasons, scope: m.scope, accessNotes: m.accessNotes, method: 'llm', model: modelStats }
  }

  // llm+rules: the model's category and wording; the union of safety flags; a safety flag from either side makes it
  // urgent, and the rules may raise the model's urgency but never lower it.
  const safety: SafetyFlag[] = [...new Set([...rules.safety, ...m.safety])]
  const category = m.category
  const urgency = safety.length ? 'urgent' : maxUrgency(m.urgency, rules.urgency)
  const reasons = [...m.reasons]
  if (rules.safety.length) reasons.push(...rules.reasons.filter((r) => r.startsWith('Flagged as urgent')))
  if (!rules.safety.length && m.safety.length) reasons.push('The model raised a safety flag, so the request is urgent.')
  return {
    category,
    urgency,
    safety,
    summary: m.summary,
    reasons,
    scope: m.scope || rules.scope,
    accessNotes: m.accessNotes ?? rules.accessNotes,
    method: 'llm+rules',
    model: modelStats,
  }
}
