// Guards on a reply draft. They always run on a model's draft, before a person sees it:
// - promises: a sentence that commits to a date, a payment, a rent change or an approval is removed and flagged;
// - citations: a clause that doesn't exist is replaced with one that does (or removed), and a missing citation is
//   added, in the form "(Tenancy terms §7)".
// Nothing here sends anything: the result is still a draft waiting for a person.
import { citation, clauseExists, getClause } from './terms'
import { PROMISE_LABEL, type PromiseKind, type TriageFlag } from './types'

// ---------------------------------------------------------------------------------------------------- promises

const NEGATION_BEFORE = /\b(not|never|no|cannot|can't|won't|unable|don't|doesn't|isn't|aren't|wasn't|haven't|hasn't)\b[^.!?]{0,25}$/i
const CONDITIONAL = /\b(if|unless|whether|once|until|subject to|need|needs|must|require|requires|required)\b/i

const ACTOR =
  '(?:we|i|someone|somebody|our (?:team|office|plumber|electrician|contractor|tradesperson|locksmith)|' +
  '(?:a|an|the) (?:tradesperson|plumber|electrician|locksmith|contractor|technician|builder|roofer|gardener|cleaner|member of (?:our|the) team|team member))'
const DATE_COMMITMENT = new RegExp(`\\b${ACTOR}(?:'ll|\\s+will|\\s+shall|\\s+(?:is|are|am) going to|\\s+can)\\b`, 'i')
const DATE_PASSIVE =
  /\b(will|'ll) be (fixed|repaired|sorted|done|replaced|completed|resolved|there|with you|out|round|over|in touch)\b|\byou('ll|\s+will)\s+(hear|get a call|be contacted)\b/i
const TIME_EXPRESSION = new RegExp(
  '\\b(today|tonight|tomorrow|this (morning|afternoon|evening|week|weekend|arvo)|' +
    'next (week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|' +
    '(on|by|this|before|until) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|by (the )?(end|close) of|' +
    'within (the next )?(\\d+|one|two|three|four|five|a few|a couple of) (minutes?|hours?|days?|working days?|business days?|weeks?)|' +
    'in (\\d+|one|two|three|a few|a couple of) (hours?|days?|weeks?)|' +
    '(on|by) (the )?\\d{1,2}(st|nd|rd|th)?( of)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|' +
    '\\d{1,2}(:\\d{2})? ?(am|pm)|first thing)\\b',
  'i',
)

interface PromiseRule {
  re: RegExp
  /** Skip the match when the sentence is conditional ("if it is approved", "needs written approval"). */
  conditional?: boolean
}

const PAYMENT_RULES: PromiseRule[] = [
  { re: /\b(we|i)('ll|\s+will|\s+shall|\s+can|\s+are going to|\s+have|'ve)\s+(refund|reimburse|repay|pay|compensate|credit|cover|waive|return|release|transfer)\b/i },
  {
    re: /\b(refund|reimbursement|compensation|credit|bond|overpayment|the extra)\b[^.!?]{0,40}\b(will be|has been|is being|have been|'ll be)\s+(paid|processed|issued|refunded|returned|released|transferred|credited|reimbursed|covered|waived)\b/i,
  },
  { re: /\byou('ll|\s+will)\s+(receive|get|be (refunded|reimbursed|paid|compensated|credited))\b/i },
  { re: /\b(we|i)('ll|\s+will)\s+(waive|write off)\b/i },
]

const RENT_RULES: PromiseRule[] = [
  { re: /\b(we|i)('ll|\s+will|\s+can|\s+have|'ve|\s+are going to)\s+(reduce|lower|decrease|discount|freeze|cut|drop|increase|raise|adjust|change)\b[^.!?]{0,30}\brent\b/i },
  { re: /\brent\b[^.!?]{0,40}\b(will (now )?be|has been|is being|is now|'ll be)\s+(reduced|lowered|decreased|discounted|frozen|cut|dropped|increased|raised|adjusted|changed)\b/i },
  { re: /\brent\b[^.!?]{0,20}\b(will (now )?be|is now|becomes)\s+\$\d/i },
  { re: /\b(approved?|agreed?( to)?|granted?|confirm(ed)?)\b[^.!?]{0,30}\brent (reduction|decrease|discount|freeze|change|increase)\b/i },
  { re: /\b(reduction|decrease|discount)\b[^.!?]{0,30}\b(is|has been|was|will be)\s+(approved|agreed|granted|confirmed|applied)\b/i },
]

const APPROVAL_RULES: PromiseRule[] = [
  { re: /\b(is|are|has been|have been|was|were|'s been|'re)\s+(approved|granted|allowed|permitted|accepted)\b/i, conditional: true },
  { re: /\bwe('re|\s+are)?\s+(happy|pleased|glad)\s+to\s+(approve|allow|agree|accept|let you|give (you )?(permission|consent))\b/i },
  { re: /\b(we|i)\s+(approve|agree to|consent to|give (you )?(our )?(permission|consent)|grant)\b/i },
  { re: /\b(we|i)('ll|\s+will)\s+(approve|allow|agree to|accept|let you|give (you )?(permission|consent))\b/i },
  {
    re: /\byou\s+(can|may|are (now )?(allowed|permitted|welcome) to)\s+(now\s+)?(go ahead|sublet|sub-let|rent (it|the place|your room|the property) out|paint|add (her|him|them|a flatmate|another)|move (in|out) (early|earlier|sooner)|break (the|your) lease|end (the|your) (lease|tenancy) (early|sooner)|have (them|your wh[āa]nau|your family|your guests) stay|pay (fortnightly|weekly|\$))/i,
    conditional: true,
  },
  {
    re: /\byou\s+(can|may|are (now )?(allowed|permitted|welcome) to)\s+(now\s+)?(keep|have|get|bring|adopt)\s+(a|an|the|your|this|that)?\s*(cat|dog|pet|puppy|kitten|rabbit|bird|animal)s?\b/i,
    conditional: true,
  },
  { re: /\b(permission|approval|consent)\s+(is|has been)\s+(given|granted)\b/i, conditional: true },
]

function ruleHits(sentence: string, rules: PromiseRule[]): boolean {
  for (const rule of rules) {
    const m = rule.re.exec(sentence)
    if (!m) continue
    if (NEGATION_BEFORE.test(sentence.slice(0, m.index))) continue
    if (rule.conditional && CONDITIONAL.test(sentence)) continue
    return true
  }
  return false
}

/** What a single sentence promises, if anything. */
export function detectPromises(sentence: string): PromiseKind[] {
  const kinds: PromiseKind[] = []
  if ((DATE_COMMITMENT.test(sentence) || DATE_PASSIVE.test(sentence)) && TIME_EXPRESSION.test(sentence)) kinds.push('date')
  if (ruleHits(sentence, PAYMENT_RULES)) kinds.push('payment')
  if (ruleHits(sentence, RENT_RULES)) kinds.push('rent_change')
  if (ruleHits(sentence, APPROVAL_RULES)) kinds.push('approval')
  return kinds
}

/** Sentences of one line; a sentence ends at . ! or ? followed by a space and a capital, digit or bracket. */
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=["'(\[A-Z0-9Ā-Ž])/)
}

export interface RemovedSentence {
  sentence: string
  kinds: PromiseKind[]
}

/** Removes every sentence that makes a promise. Greeting, paragraphs and sign-off are kept. */
export function removePromises(draft: string): { text: string; removed: RemovedSentence[] } {
  const removed: RemovedSentence[] = []
  const lines = draft.split('\n').map((line) => {
    if (!line.trim()) return line
    const kept = sentencesOf(line).filter((sentence) => {
      const kinds = detectPromises(sentence)
      if (kinds.length === 0) return true
      removed.push({ sentence: sentence.trim(), kinds })
      return false
    })
    return kept.length ? kept.join(' ') : null
  })
  const text = lines
    .filter((l): l is string => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, removed }
}

export function promiseFlags(removed: RemovedSentence[]): TriageFlag[] {
  return removed.map((r) => ({
    type: 'promise' as const,
    person: true,
    message: `The draft promised ${r.kinds.map((k) => PROMISE_LABEL[k]).join(' and ')}, so that sentence was removed. Decide what to tell the tenant.`,
    detail: r.sentence,
  }))
}

// --------------------------------------------------------------------------------------------------- citations

const SIGN_OFF = /^(ngā mihi|nga mihi|kind regards|regards|warm regards|best regards|many thanks|thanks|thank you|cheers|nāku noa|naku noa)\b.*$/i

/** Normalises citation spellings to "(Tenancy terms §7)". */
export function normaliseCitations(text: string): string {
  return text
    .replace(/\(\s*(?:see\s+)?(?:our\s+)?tenancy\s+terms\s*,?\s*(?:clause|section)?\s*§?\s*(\d{1,3})\s*\)/gi, (_m, n) => citation(Number(n)))
    .replace(/\(\s*§\s*(\d{1,3})\s*\)/g, (_m, n) => citation(Number(n)))
}

function insertBeforeSignOff(text: string, sentence: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
    if (SIGN_OFF.test(lines[i].trim())) {
      return [...lines.slice(0, i), sentence, '', ...lines.slice(i)].join('\n').replace(/\n{3,}/g, '\n\n')
    }
  }
  return `${text}\n\n${sentence}`
}

export interface CitationCheck {
  text: string
  cited: number[]
  flags: TriageFlag[]
}

/**
 * Checks the clauses a draft cites. A clause that doesn't exist is replaced with the first valid preferred clause
 * (or removed when there is none); a draft that must cite a clause and doesn't gets a citation added before the
 * sign-off.
 */
export function checkCitations(draft: string, opts: { preferred: number[]; required: boolean }): CitationCheck {
  const flags: TriageFlag[] = []
  let text = normaliseCitations(draft)
  const valid = opts.preferred.filter(clauseExists)

  text = text.replace(/\(Tenancy terms §(\d{1,3})\)|§\s?(\d{1,3})/g, (match, inParens: string | undefined, bare: string | undefined) => {
    const n = Number(inParens ?? bare)
    if (clauseExists(n)) return match
    const replacement = valid[0]
    if (replacement !== undefined) {
      flags.push({
        type: 'citation',
        person: false,
        message: `The draft cited §${n}, which isn't in the tenancy terms; it now cites §${replacement}. Check the clause fits.`,
      })
      return inParens ? citation(replacement) : `§${replacement}`
    }
    flags.push({ type: 'citation', person: true, message: `The draft cited §${n}, which isn't in the tenancy terms; the citation was removed.` })
    return ''
  })
  text = text.replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' ')

  let cited = [...new Set([...text.matchAll(/§\s?(\d{1,3})/g)].map((m) => Number(m[1])))].filter(clauseExists)
  if (opts.required && cited.length === 0 && valid.length > 0) {
    const n = valid[0]
    const title = getClause(n)?.title.toLowerCase() ?? 'this'
    text = insertBeforeSignOff(text, `You can read more about ${title} in our tenancy terms ${citation(n)}.`)
    cited = [n]
    flags.push({ type: 'citation', person: false, message: `The draft didn't cite the tenancy terms, so a citation of §${n} was added.` })
  }
  return { text, cited, flags }
}
