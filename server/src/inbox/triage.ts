// Triage of one email, without the database:
// - analyse(): rules that always run (sender linking, urgent safety signals, injection patterns, clause retrieval);
// - rulesTriage(): rules-only mode (keyword category, template reply citing the matched clause, needs a person);
// - modelOnlyTriage(): the model's raw output with no guards (used by the evaluation for comparison);
// - combinedTriage(): the shipped pipeline: the model's output, raised by the rules and checked by the guards.
import { aiEnabled } from '../ai/llm'
import { checkCitations, detectPromises, promiseFlags, removePromises, type RemovedSentence } from './guards'
import { linkSender, type Directory, type LinkResult } from './link'
import { buildTriageRequest, callTriageModel, type ModelOutput } from './model'
import {
  categorise,
  categoryScores,
  injectionMatches,
  rulesIsMaintenance,
  rulesUrgency,
  safetySignals,
  type SafetySignal,
} from './rules'
import { neutralReply, templateReply } from './templates'
import { citedClauseNumbers, clauseExists, defaultClause, primaryClause, retrieveClauses, type ScoredClause } from './terms'
import { maxUrgency, type Category, type EmailInput, type TriageFlag, type TriageMethod, type Urgency } from './types'

export interface Analysis {
  link: LinkResult
  safety: SafetySignal[]
  injection: string[]
  candidates: ScoredClause[]
  rules: {
    category: Category
    urgency: Urgency
    scores: Record<Category, number>
    isMaintenance: boolean
  }
}

export interface TriageResult {
  method: TriageMethod
  category: Category
  urgency: Urgency
  summary: string
  needsPerson: boolean
  /** Why a person is needed, one line each (empty when the draft is routine). */
  reasons: string[]
  flags: TriageFlag[]
  replyDraft: string
  citedClauses: number[]
  clauseCandidates: number[]
  maintenance: { isIssue: boolean; title: string; description: string }
  link: LinkResult
  /** The model's draft before the guards ran (null in rules-only mode). */
  modelDraft: string | null
  removedSentences: RemovedSentence[]
  /** Sentences in the model's draft that promised something. */
  promiseHits: number
  model: { name: string; cached: boolean; category: Category; urgency: Urgency; needsPerson: boolean } | null
  /** What the rules alone decided, kept for comparison. */
  rules: { category: Category; urgency: Urgency }
}

export function analyse(email: EmailInput, dir: Directory): Analysis {
  const link = linkSender(email, dir)
  const safety = safetySignals(email.subject, email.text)
  const injection = injectionMatches(email.subject, email.text)
  const scores = categoryScores(email.subject, email.text)
  const category = safety.length > 0 ? 'maintenance' : categorise(scores)
  return {
    link,
    safety,
    injection,
    candidates: retrieveClauses(email.subject, email.text, { urgentSafety: safety.length > 0 }),
    rules: {
      category,
      urgency: rulesUrgency(category, email.subject, email.text, safety),
      scores,
      isMaintenance: rulesIsMaintenance(category, scores, safety),
    },
  }
}

const CATEGORY_LABEL: Record<Category, string> = {
  maintenance: 'Maintenance',
  rent: 'Rent',
  lease_question: 'Lease question',
  complaint: 'Complaint',
  end_of_tenancy: 'End of tenancy',
  other: 'Other',
}

/** Flags every method shares: they come from rules that always run. */
function ruleFlags(a: Analysis, isMaintenance: boolean): TriageFlag[] {
  const flags: TriageFlag[] = []
  if (a.safety.length > 0) {
    flags.push({ type: 'urgent_safety', person: true, message: `Possible urgent safety issue: ${a.safety.map((s) => s.label).join(', ')}. Phone the tenant.` })
  }
  if (a.injection.length > 0) {
    flags.push({
      type: 'injection',
      person: true,
      message: 'The email contains instructions aimed at an automated assistant, so the reply is a neutral template. Nothing it asks for has been done.',
      detail: a.injection[0],
    })
  }
  const link = a.link
  if (link.method === 'signature') {
    flags.push({ type: 'unverified_sender', person: true, message: `${link.note} Confirm it's them before sharing tenancy details.` })
  } else if (!link.knownSender) {
    flags.push({ type: link.contractor ? 'contractor' : 'unknown_sender', person: true, message: link.note })
  }
  if (isMaintenance && !link.property) {
    flags.push({ type: 'not_linked', person: true, message: "This reports a repair, but the property couldn't be identified, so no maintenance job was created." })
  }
  return flags
}

function ticketFallback(email: EmailInput): { title: string; description: string } {
  const title = email.subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Repair reported by email'
  const body = email.text.replace(/\s+/g, ' ').trim()
  return { title, description: body.length > 600 ? `${body.slice(0, 597)}...` : body }
}

const firstName = (a: Analysis) => a.link.tenant?.firstName ?? null

/** Rules-only mode: keyword category and urgency, a template reply citing the matched clause, always needs a person. */
export function rulesTriage(email: EmailInput, a: Analysis): TriageResult {
  const { category, urgency, isMaintenance } = a.rules
  const clause = primaryClause(a.candidates, category, a.safety.length > 0)
  const citeClause = category !== 'other' || a.link.knownSender ? clause : null
  const reply =
    a.injection.length > 0
      ? neutralReply(firstName(a), clause)
      : templateReply({ category, firstName: firstName(a), knownSender: a.link.knownSender, clauseNumber: citeClause, safety: a.safety })
  const flags = [
    ...ruleFlags(a, isMaintenance),
    { type: 'rules_only' as const, person: true, message: 'Triaged by the rules only (no model), so every message is checked by a person.' },
  ]
  return {
    method: 'rules',
    category,
    urgency,
    summary: `${CATEGORY_LABEL[category]} email: "${email.subject}".`,
    needsPerson: true,
    reasons: flags.filter((f) => f.person).map((f) => f.message),
    flags,
    replyDraft: reply,
    citedClauses: citedClauseNumbers(reply).filter(clauseExists),
    clauseCandidates: a.candidates.map((c) => c.number),
    maintenance: { isIssue: isMaintenance, ...ticketFallback(email) },
    link: a.link,
    modelDraft: null,
    removedSentences: [],
    promiseHits: 0,
    model: null,
    rules: { category: a.rules.category, urgency: a.rules.urgency },
  }
}

const countPromises = (draft: string) =>
  draft
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .filter((s) => detectPromises(s).length > 0).length

/** The model's raw output as a triage result, with no rules or guards applied (evaluation only). */
export function modelOnlyTriage(email: EmailInput, a: Analysis, out: ModelOutput, model = 'model', cached = false): TriageResult {
  return {
    method: 'llm',
    category: out.category,
    urgency: out.urgency,
    summary: out.summary,
    needsPerson: out.needs_person,
    reasons: out.needs_person && out.needs_person_reason ? [out.needs_person_reason] : [],
    flags: [],
    replyDraft: out.reply_draft,
    citedClauses: citedClauseNumbers(out.reply_draft),
    clauseCandidates: a.candidates.map((c) => c.number),
    maintenance: { isIssue: out.maintenance.is_issue, title: out.maintenance.ticket_title, description: out.maintenance.ticket_description },
    link: a.link,
    modelDraft: out.reply_draft,
    removedSentences: [],
    promiseHits: countPromises(out.reply_draft),
    model: { name: model, cached, category: out.category, urgency: out.urgency, needsPerson: out.needs_person },
    rules: { category: a.rules.category, urgency: a.rules.urgency },
  }
}

/**
 * The shipped pipeline. The rules can raise the urgency or require a person but never lower either; promises are
 * removed from the draft; citations are checked; an email that tries to instruct the assistant gets a neutral reply.
 */
export function combinedTriage(email: EmailInput, a: Analysis, out: ModelOutput, model = 'model', cached = false): TriageResult {
  const isMaintenance = out.maintenance.is_issue || a.safety.length > 0
  const urgency = a.safety.length > 0 ? maxUrgency(out.urgency, 'urgent') : out.urgency
  const flags = ruleFlags(a, isMaintenance)
  if (out.needs_person) {
    flags.unshift({ type: 'model', person: true, message: out.needs_person_reason.trim() || 'The model marked this message for a person.' })
  }

  // Promises: always checked on the model's draft, so the count is comparable with the model-only run.
  const promises = removePromises(out.reply_draft)
  flags.push(...promiseFlags(promises.removed))

  const validModelClauses = out.clauses.filter(clauseExists)
  const preferred = [...new Set([...validModelClauses, ...a.candidates.map((c) => c.number), defaultClause(out.category)])]
  let draft = promises.text
  if (a.injection.length > 0) draft = neutralReply(firstName(a), primaryClause(a.candidates, out.category, a.safety.length > 0))
  const checked = checkCitations(draft, { preferred, required: out.category !== 'other' || a.link.knownSender })
  flags.push(...checked.flags)

  const title = out.maintenance.ticket_title.trim()
  const description = out.maintenance.ticket_description.trim()
  const fallback = ticketFallback(email)
  const needsPerson = flags.some((f) => f.person)
  return {
    method: 'llm+rules',
    category: out.category,
    urgency,
    summary: out.summary.trim() || `${CATEGORY_LABEL[out.category]} email: "${email.subject}".`,
    needsPerson,
    reasons: flags.filter((f) => f.person).map((f) => f.message),
    flags,
    replyDraft: checked.text,
    citedClauses: checked.cited,
    clauseCandidates: a.candidates.map((c) => c.number),
    maintenance: { isIssue: isMaintenance, title: title || fallback.title, description: description || fallback.description },
    link: a.link,
    modelDraft: out.reply_draft,
    removedSentences: promises.removed,
    promiseHits: promises.removed.length,
    model: { name: model, cached, category: out.category, urgency: out.urgency, needsPerson: out.needs_person },
    rules: { category: a.rules.category, urgency: a.rules.urgency },
  }
}

/** Triage one email: the model with rules and guards when a model is configured, otherwise the rules alone. */
export async function triageEmail(email: EmailInput, dir: Directory, opts: { useModel?: boolean } = {}): Promise<TriageResult> {
  const a = analyse(email, dir)
  const useModel = opts.useModel ?? aiEnabled()
  if (!useModel) return rulesTriage(email, a)
  try {
    const call = await callTriageModel(buildTriageRequest(email, a.link, a.candidates))
    return combinedTriage(email, a, call.output, call.model, call.cached)
  } catch (e) {
    const result = rulesTriage(email, a)
    result.flags.unshift({
      type: 'model_error',
      person: true,
      message: `The model wasn't available (${e instanceof Error ? e.message : 'unknown error'}), so the rules triaged this message.`,
    })
    result.reasons = result.flags.filter((f) => f.person).map((f) => f.message)
    return result
  }
}
