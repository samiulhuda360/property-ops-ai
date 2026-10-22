// The risk playbook (playbook/lease-risks.yaml) applied to an abstracted lease: tests on the terms, regular
// expressions on the text, and for every finding the page and the sentence it rests on.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { locateQuote, sentenceAround } from './text'
import type { ExtractedTerms, LeaseTerms, LeaseType, PageText, RiskFinding, TermField } from './types'

export const PLAYBOOK_PATH = resolve(__dirname, '../../playbook/lease-risks.yaml')

type Test = { eq?: unknown; ne?: unknown; lt?: number; lte?: number; gt?: number; gte?: number; in?: unknown[]; present?: boolean; absent?: boolean }

export interface PlaybookRule {
  code: string
  title: string
  severity: 'high' | 'medium' | 'low'
  explanation: string
  when?: Record<string, Test>
  pattern?: string
  absent?: string
  cite?: TermField
}

export interface Playbook {
  version: number
  rules: PlaybookRule[]
}

let cached: Playbook | null = null

export function loadPlaybook(path = PLAYBOOK_PATH): Playbook {
  if (cached && path === PLAYBOOK_PATH) return cached
  const doc = parse(readFileSync(path, 'utf8')) as Playbook
  if (!doc || !Array.isArray(doc.rules)) throw new Error(`${path} has no rules list`)
  for (const r of doc.rules) {
    if (!r.code || !r.title || !r.severity) throw new Error(`Playbook rule without code, title or severity: ${JSON.stringify(r)}`)
    if (r.pattern) new RegExp(r.pattern, 'i')
    if (r.absent) new RegExp(r.absent, 'i')
  }
  if (path === PLAYBOOK_PATH) cached = doc
  return doc
}

function passes(value: unknown, test: Test): boolean {
  const blank = value === null || value === undefined
  if (test.present !== undefined && test.present !== !blank) return false
  if (test.absent !== undefined && test.absent !== blank) return false
  if ('eq' in test && value !== test.eq) return false
  if ('ne' in test && value === test.ne) return false
  if (test.in && !test.in.some((x) => x === value || (x === null && blank))) return false
  const n = typeof value === 'number' ? value : null
  if (test.lt !== undefined && (n === null || !(n < test.lt))) return false
  if (test.lte !== undefined && (n === null || !(n <= test.lte))) return false
  if (test.gt !== undefined && (n === null || !(n > test.gt))) return false
  if (test.gte !== undefined && (n === null || !(n >= test.gte))) return false
  return true
}

export function findRisks(
  terms: LeaseTerms,
  extracted: Partial<ExtractedTerms> | null,
  pages: PageText[],
  leaseType: LeaseType,
  playbook: Playbook = loadPlaybook(),
): RiskFinding[] {
  // flat has the line breaks replaced by spaces, one for one, so an index into it is an index into raw.
  const raw = pages.map((p) => p.text).join(String.fromCharCode(10))
  const flat = raw.split(String.fromCharCode(10)).join(' ')
  const facts: Record<string, unknown> = { ...terms, leaseType }
  const findings: RiskFinding[] = []
  for (const rule of playbook.rules) {
    if (rule.when && !Object.entries(rule.when).every(([field, test]) => passes(facts[field], test))) continue
    if (rule.absent && new RegExp(rule.absent, 'i').test(flat)) continue
    let page: number | null = null
    let quote: string | null = null
    if (rule.pattern) {
      const m = flat.match(new RegExp(rule.pattern, 'i'))
      if (!m) continue
      quote = sentenceAround(raw, m.index ?? 0, m[0].length)
      page = locateQuote(pages, quote)?.page ?? null
    } else if (rule.cite && extracted?.[rule.cite]) {
      page = extracted[rule.cite]!.page
      quote = extracted[rule.cite]!.quote
    }
    findings.push({ code: rule.code, title: rule.title, severity: rule.severity, explanation: rule.explanation, page, quote, status: 'open' })
  }
  return findings
}
