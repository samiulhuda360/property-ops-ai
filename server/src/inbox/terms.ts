// The tenancy terms (data/knowledge/tenancy-terms.md): parsing, retrieval of the clauses that may apply to an email,
// and the citation format replies use: "(Tenancy terms §7)".
import { readFileSync } from 'node:fs'
import { termsPath } from './data'
import type { Category } from './types'

export interface Clause {
  number: number
  title: string
  text: string
}

export interface ScoredClause {
  number: number
  score: number
}

/** Splits the terms into clauses at each "## §N Title" heading. */
export function parseClauses(markdown: string): Clause[] {
  const heads = [...markdown.matchAll(/^## §(\d+) (.+)$/gm)]
  return heads.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < heads.length ? heads[i + 1].index ?? markdown.length : markdown.length
    return { number: Number(m[1]), title: m[2].trim(), text: markdown.slice(start, end).trim().replace(/\s*\n\s*/g, ' ') }
  })
}

let cached: Clause[] | null = null

export function loadClauses(): Clause[] {
  if (!cached) cached = parseClauses(readFileSync(termsPath(), 'utf8'))
  return cached
}

export function getClause(n: number): Clause | null {
  return loadClauses().find((c) => c.number === n) ?? null
}

export function clauseExists(n: number): boolean {
  return getClause(n) !== null
}

export const citation = (n: number) => `(Tenancy terms §${n})`

/** Every clause number a text cites as §N, in order, without repeats. */
export function citedClauseNumbers(text: string): number[] {
  const seen: number[] = []
  for (const m of text.matchAll(/§\s?(\d{1,3})/g)) {
    const n = Number(m[1])
    if (!seen.includes(n)) seen.push(n)
  }
  return seen
}

// Words that point at each clause. A match in the subject counts twice. §8 (urgent repairs) is added by the
// urgent safety rules rather than by keywords, so a polite email about a burning power point still retrieves it.
const CLAUSE_KEYWORDS: Record<number, RegExp[]> = {
  2: [/\bautomatic payment\b/, /\baccount (number|details)\b/, /\bfortnightly\b/, /\bcash\b/, /\breference\b/, /\bpay(ing)? (the |my )?rent\b/],
  3: [
    /\blate\b/,
    /\bbehind\b|\barrears\b/,
    /\bmissed\b/,
    /\b(can'?t|cannot|won'?t be able to|unable to) pay\b/,
    /\bhours\b[^.]{0,30}\bcut\b/,
    /\bhardship\b|\bstruggling to pay\b/,
    /\bpayment (plan|arrangement)\b|\bmake up the difference\b|\bcatch up\b/,
  ],
  4: [
    /\breceipts?\b/,
    /\bstatement\b/,
    /\b(changed|moved|switch(ed)?|new) (bank|banks|bank account)\b|\bnew account\b/,
    /\bpaid twice\b|\bwent through twice\b|\bdouble payment\b|\boverpa(id|yment)\b/,
    /\bon (her|his|their|my) behalf\b|\bpaid (her|his|their) rent\b|\bfrom my account\b/,
    /\bcredit\b/,
  ],
  5: [/\brent (increase|reduction|decrease|review|rise)\b/, /\b(reduce|reduction|lower|increase|raise)\b[^.]{0,25}\brent\b/, /\bgoing up\b/, /\bhow often\b[^.]{0,30}\bgo up\b/],
  6: [/\bbond\b/],
  7: [
    /\brepair/,
    /\bfix(ed|ing)?\b/,
    /\bbroken\b|\bnot working\b|\bisn'?t working\b|\bstopped (working|draining|clicking)\b/,
    /\bleak/,
    /\bdrip/,
    /\btaps?\b/,
    /\b(oven|hob|stove|igniter|dishwasher|rangehood)\b/,
    /\b(fence|palings|gate)\b/,
    /\bwindow\b|\blatch\b/,
    /\btowel rail\b|\bhandle\b/,
    /\brats?\b|\bmice\b|\bpest/,
    /\bplumber\b|\belectrician\b|\btradesperson\b/,
  ],
  9: [/\bpets?\b/, /\bcats?\b/, /\bdogs?\b/, /\bpupp(y|ies)\b|\bkittens?\b/, /\banimals?\b/],
  10: [
    /\binspection\b/,
    /\b(came|come) into the house\b|\blet yourselves in\b|\bwithout (notice|telling)\b|\bnobody told me\b/,
    /\bspare key\b/,
    /\bbe home\b/,
  ],
  11: [
    /\bsub-?let/,
    /\bshort-term\b|\bholiday[- ]rental\b|\brent (the place|it|my room) out\b/,
    /\bflatmate/,
    /\bmove in with\b/,
    /\bguests?\b|\bstay with us\b|\bvisitors\b/,
    /\bwh[āa]nau\b/,
  ],
  12: [/\bnotice\b/, /\bend(ing)? (our|my|the) tenancy\b/, /\bmov(e|ing) out\b/, /\blast day\b/, /\bleave in\b|\bleaving\b/],
  13: [/\bbreak(ing)? (the|my|our) lease\b|\blease break\b/, /\bfixed[- ]term\b/, /\brolls? over\b|\brenew/, /\blease anniversary\b/],
  14: [/\bsmoke alarms?\b/, /\bchirp/, /\bbeep/],
  15: [/\bmou?ld\b/, /\bcondensation\b/, /\bdamp\b/, /\bextractor\b|\bfan\b/, /\bventilat/],
  16: [/\bpaint/, /\bhooks?\b/, /\bnails?\b|\bscrews?\b|\bdrill/, /\bshel(f|ves)\b/, /\balteration/],
  17: [
    /\bnois(e|y)\b/,
    /\bloud\b/,
    /\bmusic\b/,
    /\bpart(y|ies)\b/,
    /\bneighbou?rs?\b|\bnext door\b|\bupstairs\b/,
    /\bbark/,
    /\bcigarette\b|\bsmokes\b/,
    /\bshout|\bthreat/,
  ],
  18: [/\bkeys?\b/, /\blocked out\b/, /\block(s|ed)?\b/, /\blocksmith\b/, /\bbreak-?in\b|\bbroke in(to)?\b/],
  19: [/\binsurance\b/, /\binsured?\b/, /\bdamage\b/, /\bbelongings\b/],
  20: [
    /\bbond\b[^.]{0,40}\b(back|refund)|\brefund[^.]{0,20}\bbond\b/,
    /\bfinal inspection\b/,
    /\bcarpets?\b/,
    /\bmoved out\b|\bmoving out\b/,
    /\b(drop|return)(ing)? (off )?(the )?keys\b/,
  ],
  21: [/\bphone number\b|\bmobile number\b|\bnumber has changed\b/, /\bemail address\b/, /\bupdate (your|my|the) records\b/, /\breply\b/],
}

/** Clauses whose subject matter fits each category, used to pick the clause a template reply cites. */
const CATEGORY_CLAUSES: Record<Category, number[]> = {
  maintenance: [8, 7, 14, 15, 18],
  rent: [2, 3, 4, 5],
  lease_question: [9, 10, 11, 13, 16, 19],
  complaint: [17, 10, 21],
  end_of_tenancy: [12, 13, 20, 6],
  other: [21],
}

const CATEGORY_DEFAULT: Record<Category, number> = {
  maintenance: 7,
  rent: 2,
  lease_question: 11,
  complaint: 17,
  end_of_tenancy: 12,
  other: 21,
}

/**
 * Ranks the clauses that may apply to an email by keyword matches. Urgent safety signals put §8 first. Returns at most
 * `limit` clauses with a score above zero; §21 (how we communicate) when nothing matches.
 */
export function retrieveClauses(subject: string, body: string, opts: { urgentSafety: boolean; limit?: number }): ScoredClause[] {
  const limit = opts.limit ?? 4
  const s = subject.toLowerCase()
  const b = body.toLowerCase()
  const scored: ScoredClause[] = []
  for (const [num, patterns] of Object.entries(CLAUSE_KEYWORDS)) {
    let score = 0
    for (const re of patterns) {
      if (re.test(s)) score += 2
      if (re.test(b)) score += 1
    }
    if (score > 0) scored.push({ number: Number(num), score })
  }
  scored.sort((x, y) => y.score - x.score || x.number - y.number)
  let top = scored.slice(0, limit)
  if (opts.urgentSafety) top = [{ number: 8, score: 99 }, ...top.filter((c) => c.number !== 8)].slice(0, limit + 1)
  if (top.length === 0) top = [{ number: 21, score: 0 }]
  return top.filter((c) => clauseExists(c.number))
}

/** The one clause a rules-only reply cites: §8 for urgent repairs, else the best-scoring clause for the category. */
export function primaryClause(candidates: ScoredClause[], category: Category, urgentSafety: boolean): number {
  if (urgentSafety) return 8
  const allowed = CATEGORY_CLAUSES[category]
  const best = candidates.find((c) => allowed.includes(c.number) && c.score > 0)
  return best ? best.number : CATEGORY_DEFAULT[category]
}

export function defaultClause(category: Category): number {
  return CATEGORY_DEFAULT[category]
}
