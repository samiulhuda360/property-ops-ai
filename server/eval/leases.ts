// Evaluates lease abstraction on two labelled synthetic sets: the 24 leases in the schedule-table layouts the rules
// were written for (data/leases/truth.json) and 8 held-out leases in narrative wording (data/leases/heldout/truth.json).
// Runs every lease through the rules, the model alone and the hybrid route, then writes eval/results/leases.md and
// leases.json at the repo root: field accuracy per route (overall, per field, per country and lease type), the checks,
// risk-flag precision and recall against the labels, the planted reconciliation mismatches found, latency and the
// cost per lease from the tokens the API reported.
//
//   npx tsx eval/leases.ts                                      (from server/; rules only without a key)
//   AI_API_KEY="$GEMINI_API_KEY" npx tsx eval/leases.ts         (all three routes; replies are cached on disk)
//   AI_DRIVER=replay npx tsx eval/leases.ts                     (all three routes from the committed cache, no key)
//   npx tsx eval/leases.ts --render                             (rebuild the .md from the saved .json)
import 'dotenv/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AiError, aiConfig, aiEnabled } from '../src/ai/llm'
import { canonical, sameTermValue } from '../src/leases/compare'
import { abstractLease, type Abstraction } from '../src/leases/pipeline'
import { reconcileCharges, type IssuedInvoiceRef } from '../src/leases/reconcile'
import { csvCells } from '../src/leases/service'
import { pdfPages } from '../src/leases/text'
import { FIELD_LABELS, isAlarm, TERM_FIELDS, type Confidence, type Route, type TermField } from '../src/leases/types'

const DATA_DIR = resolve(__dirname, '../../data/leases')
const OUT_DIR = resolve(__dirname, '../../eval/results')
const ROUTE_NAMES: Record<Route, string> = { rules: 'Rules', llm: 'Model', hybrid: 'Hybrid' }

/** List price assumed for the cost column: USD per million tokens (Gemini 2.5 Flash-Lite, paid tier). */
const PRICE = { input: 0.1, output: 0.4 }

interface TruthLease {
  file: string
  ref: string
  country: string
  leaseType: string
  layout: string
  fields: Record<string, unknown>
  risks: string[]
  issues: string[]
  charges: unknown[]
  note?: string
}

interface Planted {
  leaseRef: string
  status: string
  kind: string
  dueDate: string
  note: string
}

interface FieldResult {
  field: string
  correct: boolean
  expected: unknown
  got: unknown
  confidence: Confidence
  needsPerson: boolean
  located: boolean
}

interface LeaseResult {
  file: string
  ref: string
  country: string
  leaseType: string
  countryDetected: boolean
  typeDetected: boolean
  fields: FieldResult[]
  expectedIssues: string[]
  raisedIssues: string[]
  expectedRisks: string[]
  raisedRisks: string[]
  mismatchesFound: { status: string; kind: string; dueDate: string }[]
  latencyMs: number
  calls: { live: number; cached: number; repaired: boolean; inputTokens: number; outputTokens: number }
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${((100 * n) / d).toFixed(1)}%`)
const frac = (c: number, t: number) => `${pct(c, t)} (${c}/${t})`
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`)
const show = (field: string, v: unknown) => {
  const c = canonical(field, v)
  if (c === null) return 'nothing'
  return typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
}

function loadInvoices(dir: string): IssuedInvoiceRef[] {
  const lines = readFileSync(join(dir, 'invoices.csv'), 'utf8').trim().split('\n').slice(1)
  return lines.map((line, i) => {
    const c = csvCells(line)
    return { id: i + 1, sourceRow: Number(c[0]), invoiceNumber: c[1], leaseRef: c[2], description: c[3], kind: c[4], amount: Number(c[5]), currency: c[6], dueDate: c[7] }
  })
}

function score(doc: TruthLease, a: Abstraction, invoices: IssuedInvoiceRef[], latencyMs: number): LeaseResult {
  const fields = TERM_FIELDS.map((field): FieldResult => {
    const got = (a.terms as unknown as Record<string, unknown>)[field]
    const x = a.extracted[field]
    return {
      field,
      correct: sameTermValue(field, doc.fields[field], got),
      expected: doc.fields[field],
      got,
      confidence: x.confidence,
      needsPerson: x.status === 'needs_person',
      located: x.page !== null,
    }
  })
  const recon = reconcileCharges(a.terms.leaseRef, a.charges, invoices)
  return {
    file: doc.file,
    ref: doc.ref,
    country: doc.country,
    leaseType: doc.leaseType,
    countryDetected: a.country === doc.country,
    typeDetected: a.leaseType === doc.leaseType,
    fields,
    expectedIssues: doc.issues,
    raisedIssues: [...new Set(a.issues.filter(isAlarm).map((i) => i.code))],
    expectedRisks: doc.risks,
    raisedRisks: a.risks.map((r) => r.code),
    mismatchesFound: recon.lines.filter((l) => l.status !== 'matched').map((l) => ({ status: l.status, kind: l.expected?.kind ?? l.invoice?.kind ?? '', dueDate: l.expected?.dueDate ?? l.invoice?.dueDate ?? '' })),
    latencyMs,
    calls: { live: a.model.live, cached: a.model.cached, repaired: a.model.repaired, inputTokens: a.model.inputTokens, outputTokens: a.model.outputTokens },
  }
}

function summarise(route: Route, results: LeaseResult[], planted: Planted[]) {
  const all = results.flatMap((r) => r.fields)
  const perField: Record<string, { correct: number; total: number }> = {}
  const byGroup = (key: (r: LeaseResult) => string) => {
    const out: Record<string, { correct: number; total: number }> = {}
    for (const r of results) {
      const k = key(r)
      out[k] ??= { correct: 0, total: 0 }
      out[k].total += r.fields.length
      out[k].correct += r.fields.filter((f) => f.correct).length
    }
    return out
  }
  for (const r of results) {
    for (const f of r.fields) {
      perField[f.field] ??= { correct: 0, total: 0 }
      perField[f.field].total++
      if (f.correct) perField[f.field].correct++
    }
  }
  const confidence: Record<Confidence, { fields: number; correct: number }> = { high: { fields: 0, correct: 0 }, medium: { fields: 0, correct: 0 }, low: { fields: 0, correct: 0 } }
  for (const f of all) {
    confidence[f.confidence].fields++
    if (f.correct) confidence[f.confidence].correct++
  }
  const flagged = all.filter((f) => f.needsPerson)
  const unflaggedWrong = all.filter((f) => !f.needsPerson && !f.correct).length
  const riskTp = results.reduce((s, r) => s + r.raisedRisks.filter((c) => r.expectedRisks.includes(c)).length, 0)
  const riskFp = results.reduce((s, r) => s + r.raisedRisks.filter((c) => !r.expectedRisks.includes(c)).length, 0)
  const riskFn = results.reduce((s, r) => s + r.expectedRisks.filter((c) => !r.raisedRisks.includes(c)).length, 0)
  const plantedFound = planted.filter((p) => {
    const r = results.find((x) => x.ref === p.leaseRef)
    return r?.mismatchesFound.some((m) => m.status === p.status && m.kind === p.kind && m.dueDate === p.dueDate)
  }).length
  const extraMismatches = results.reduce((s, r) => s + r.mismatchesFound.filter((m) => !planted.some((p) => p.leaseRef === r.ref && p.status === m.status && p.kind === m.kind && p.dueDate === m.dueDate)).length, 0)
  const inputTokens = results.reduce((s, r) => s + r.calls.inputTokens, 0)
  const outputTokens = results.reduce((s, r) => s + r.calls.outputTokens, 0)
  const plantedIssues = results.reduce((s, r) => s + r.expectedIssues.length, 0)
  const caughtIssues = results.reduce((s, r) => s + r.expectedIssues.filter((c) => r.raisedIssues.includes(c)).length, 0)
  const clean = results.filter((r) => r.expectedIssues.length === 0)
  return {
    route,
    leases: results.length,
    countryDetected: results.filter((r) => r.countryDetected).length,
    typeDetected: results.filter((r) => r.typeDetected).length,
    fieldAccuracy: { correct: all.filter((f) => f.correct).length, total: all.length, perField, byCountry: byGroup((r) => r.country), byType: byGroup((r) => r.leaseType) },
    leasesFullyCorrect: results.filter((r) => r.fields.every((f) => f.correct)).length,
    located: { withValue: all.filter((f) => f.got !== null && f.got !== undefined).length, located: all.filter((f) => f.located).length },
    needsPerson: { flagged: flagged.length, flaggedWrong: flagged.filter((f) => !f.correct).length, unflaggedWrong },
    checks: { planted: plantedIssues, caught: caughtIssues, cleanLeases: clean.length, cleanFlagged: clean.filter((r) => r.raisedIssues.length > 0).length },
    risks: { tp: riskTp, fp: riskFp, fn: riskFn, precision: riskTp + riskFp ? riskTp / (riskTp + riskFp) : 1, recall: riskTp + riskFn ? riskTp / (riskTp + riskFn) : 1 },
    reconciliation: { planted: planted.length, found: plantedFound, extra: extraMismatches },
    medianLatencyMs: median(results.map((r) => r.latencyMs)),
    modelCalls: { live: results.reduce((s, r) => s + r.calls.live, 0), cached: results.reduce((s, r) => s + r.calls.cached, 0), repairs: results.filter((r) => r.calls.repaired).length },
    tokens: { input: inputTokens, output: outputTokens },
    costUsd: (inputTokens * PRICE.input + outputTokens * PRICE.output) / 1e6,
    confidence,
  }
}

type Summary = ReturnType<typeof summarise>

interface SetReport {
  id: string
  title: string
  description: string
  meta: { leases: number; commercial: number; residential: number; plantedIssues: number; plantedMismatches: number; risks: number }
  summaries: Summary[]
  results: Record<string, LeaseResult[]>
}

interface Report {
  date: string
  model: string
  price: typeof PRICE
  sets: SetReport[]
}

const SETS = [
  {
    id: 'seen',
    title: 'Seen layouts',
    dir: DATA_DIR,
    description:
      'commercial deeds and leases with a schedule table (New Zealand deed of lease, Australian retail lease, UK lease with particulars, US lease with basic lease information) and residential agreements in four national forms. The rules and the prompt were written with these layouts in view.',
  },
  {
    id: 'heldout',
    title: 'Held-out layouts',
    dir: join(DATA_DIR, 'heldout'),
    description:
      'narrative leases with no schedule table: amounts in words and figures, dates written "1st May 2026" or "11/15/2025", terms such as "operating expenses", "yielding up" and "deposit with the landlord the sum of". Made after the rules were fixed and never used to change them.',
  },
]

function setSection(set: SetReport): string[] {
  const s = set.summaries
  const cols = s.map((x) => ROUTE_NAMES[x.route])
  const row = (label: string, cells: string[]) => `| ${label} | ${cells.join(' | ')} |`
  const rule = `|---|${cols.map(() => '---:').join('|')}|`
  const m = set.meta
  const lines: string[] = []
  lines.push(`## ${set.title} (${m.leases})`, '')
  lines.push(`${m.commercial} commercial and ${m.residential} residential leases: ${set.description} The labels carry ${m.risks} risk clauses, ${m.plantedIssues} planted check failure${m.plantedIssues === 1 ? '' : 's'} and ${m.plantedMismatches} planted invoice mismatches.`, '')
  lines.push(row('Metric', cols), rule)
  lines.push(row(`Field accuracy, all ${TERM_FIELDS.length} terms`, s.map((x) => frac(x.fieldAccuracy.correct, x.fieldAccuracy.total))))
  for (const t of ['commercial', 'residential']) {
    lines.push(row(`Field accuracy, ${t}`, s.map((x) => (x.fieldAccuracy.byType[t] ? frac(x.fieldAccuracy.byType[t].correct, x.fieldAccuracy.byType[t].total) : '–'))))
  }
  for (const c of ['NZ', 'AU', 'UK', 'US']) {
    lines.push(row(`Field accuracy, ${c}`, s.map((x) => (x.fieldAccuracy.byCountry[c] ? frac(x.fieldAccuracy.byCountry[c].correct, x.fieldAccuracy.byCountry[c].total) : '–'))))
  }
  lines.push(row('Leases with every term correct', s.map((x) => `${x.leasesFullyCorrect}/${x.leases}`)))
  lines.push(row('Country and lease type detected', s.map((x) => `${x.countryDetected}/${x.leases}, ${x.typeDetected}/${x.leases}`)))
  lines.push(row('Terms with a page located', s.map((x) => frac(x.located.located, x.located.withValue))))
  lines.push(row('Terms sent to a person (of which wrong)', s.map((x) => `${x.needsPerson.flagged} (${x.needsPerson.flaggedWrong})`)))
  lines.push(row('Wrong terms NOT sent to a person', s.map((x) => String(x.needsPerson.unflaggedWrong))))
  lines.push(row('Planted check failures caught', s.map((x) => `${x.checks.caught}/${x.checks.planted}`)))
  lines.push(row('Clean leases with a false alarm', s.map((x) => `${x.checks.cleanFlagged}/${x.checks.cleanLeases}`)))
  lines.push(row('Risk flags: precision', s.map((x) => `${(100 * x.risks.precision).toFixed(1)}% (${x.risks.tp}/${x.risks.tp + x.risks.fp})`)))
  lines.push(row('Risk flags: recall', s.map((x) => `${(100 * x.risks.recall).toFixed(1)}% (${x.risks.tp}/${x.risks.tp + x.risks.fn})`)))
  if (m.plantedMismatches) {
    lines.push(row('Planted invoice mismatches found', s.map((x) => `${x.reconciliation.found}/${x.reconciliation.planted}`)))
    lines.push(row('Mismatches reported that were not planted', s.map((x) => String(x.reconciliation.extra))))
  }
  lines.push(row('Median latency per lease', s.map((x) => ms(x.medianLatencyMs))))
  lines.push(row('Model calls this run: live / cached', s.map((x) => `${x.modelCalls.live} / ${x.modelCalls.cached}`)))
  lines.push(row('Leases that needed the repair call', s.map((x) => (x.route === 'hybrid' ? String(x.modelCalls.repairs) : '–'))))
  lines.push(row('Tokens: input / output', s.map((x) => (x.route === 'rules' ? '–' : `${x.tokens.input.toLocaleString('en-NZ')} / ${x.tokens.output.toLocaleString('en-NZ')}`))))
  lines.push(row('Cost per lease (list price)', s.map((x) => (x.route === 'rules' ? '$0' : `$${(x.costUsd / x.leases).toFixed(4)}`))))
  lines.push('')

  lines.push(`### ${set.title}: accuracy per term`, '', row('Term', cols), rule)
  for (const f of TERM_FIELDS) {
    lines.push(row(FIELD_LABELS[f], s.map((x) => frac(x.fieldAccuracy.perField[f].correct, x.fieldAccuracy.perField[f].total))))
  }
  lines.push('')

  const withModel = s.filter((x) => x.route !== 'rules')
  if (withModel.length) {
    lines.push(`### ${set.title}: confidence against correctness`, '')
    lines.push(row('Confidence', withModel.map((x) => ROUTE_NAMES[x.route])), `|---|${withModel.map(() => '---:').join('|')}|`)
    for (const level of ['high', 'medium', 'low'] as Confidence[]) {
      lines.push(row(level, withModel.map((x) => (x.confidence[level].fields ? `${pct(x.confidence[level].correct, x.confidence[level].fields)} of ${x.confidence[level].fields} terms` : 'no terms'))))
    }
    lines.push('')
  }
  return lines
}

function markdown(report: Report): string {
  const lines: string[] = []
  lines.push('# Lease abstraction: evaluation', '')
  lines.push(
    `Two labelled synthetic sets of leases (New Zealand, Australia, the United Kingdom and the United States; commercial and residential), each run through the rules, the model alone and the hybrid route. Run on ${report.date}${report.model ? ` with model \`${report.model}\`` : ''}.`,
    '',
  )
  for (const set of report.sets) lines.push(...setSection(set))

  lines.push('## How it is measured', '')
  lines.push(
    `- Every lease is labelled with its ${TERM_FIELDS.length} key terms, the risk clauses it contains (from the playbook's nine codes), any check it should fail, and the charges the billing system should have raised. The invoice file holds the raised invoices with planted mismatches.`,
    '- A term is correct when it equals the label after normalising: dates to ISO, money to cents, names and addresses to lower case without punctuation (one may contain the other), review dates as a sorted set. A missing value is wrong unless the lease has none.',
    '- "Sent to a person" counts terms with low confidence: a failed or disagreeing check, or (hybrid) a disagreement between the model and the rules. The number in brackets is how many of those were in fact wrong; the next row is the wrong terms that slipped through with medium or high confidence.',
    '- Risk precision and recall compare the playbook findings with the labelled risk codes per lease. The playbook runs after every route, so its findings depend on the terms that route extracted.',
    '- Reconciliation: the charge schedule derived from the extracted terms is matched to the invoice file by lease reference, kind and due date (within three days); a planted mismatch is found when the same status, kind and due date is reported.',
    `- Latency per lease: reading the PDF text, plus each model call's recorded latency (the same figure whether the reply came live or from the disk cache), plus the rules, checks, playbook and schedule. Live calls were spaced at least 4.5 s apart; that spacing is not counted.`,
    `- Cost uses the tokens the API reported for the calls, at the list price assumed for the model: $${report.price.input} per million input tokens and $${report.price.output} per million output tokens. Cached replays report the tokens of the original call.`,
    '- The hybrid route reuses the model-only call (the identical request is served from the cache) and adds one repair call when a check fails.',
    '- The rules and the prompt were written with the seen layouts in view. The held-out layouts were made afterwards and have not been used to change either, so they show how each route copes with a lease written in a form it has not met.',
    '',
  )

  lines.push('## Terms not read correctly', '')
  for (const set of report.sets) {
    for (const summary of set.summaries) {
      const bad = set.results[summary.route].filter((r) => r.fields.some((f) => !f.correct) || r.expectedRisks.some((c) => !r.raisedRisks.includes(c)) || r.raisedRisks.some((c) => !r.expectedRisks.includes(c)))
      lines.push(`### ${set.title}: ${ROUTE_NAMES[summary.route]}`, '')
      if (!bad.length) {
        lines.push('Every term and every risk clause was handled correctly.', '')
        continue
      }
      for (const r of bad) {
        const parts: string[] = []
        const wrong = r.fields.filter((f) => !f.correct)
        if (wrong.length > 8) parts.push(`${wrong.length} terms wrong (${wrong.map((f) => f.field).join(', ')})`)
        else for (const f of wrong) parts.push(`${f.field}: expected ${show(f.field, f.expected)}, read ${show(f.field, f.got)}${f.needsPerson ? ' (sent to a person)' : ''}`)
        const missed = r.expectedRisks.filter((c) => !r.raisedRisks.includes(c))
        const extra = r.raisedRisks.filter((c) => !r.expectedRisks.includes(c))
        if (missed.length) parts.push(`missed risk ${missed.join(', ')}`)
        if (extra.length) parts.push(`raised risk ${extra.join(', ')} (not labelled)`)
        lines.push(`- \`${r.file}\`: ${parts.join('; ')}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

function render() {
  const saved = JSON.parse(readFileSync(join(OUT_DIR, 'leases.json'), 'utf8')) as Report
  writeFileSync(join(OUT_DIR, 'leases.md'), markdown(saved) + '\n')
  console.log(`Rebuilt ${join(OUT_DIR, 'leases.md')} from leases.json`)
}

async function main() {
  if (process.argv.includes('--render')) return render()
  const routes: Route[] = aiEnabled() ? ['rules', 'llm', 'hybrid'] : ['rules']
  if (!aiEnabled()) console.log('No model configured (AI_API_KEY empty or AI_DRIVER=off): evaluating the rules only.')
  const report: Report = { date: new Date().toLocaleDateString('en-CA'), model: aiEnabled() ? aiConfig().model : '', price: PRICE, sets: [] }

  for (const set of SETS) {
    const truth = JSON.parse(readFileSync(join(set.dir, 'truth.json'), 'utf8')) as { leases: TruthLease[]; reconciliation: Planted[] }
    const invoices = loadInvoices(set.dir)
    const pages = new Map<string, { pages: Awaited<ReturnType<typeof pdfPages>>; ms: number }>()
    for (const doc of truth.leases) {
      const started = performance.now()
      pages.set(doc.file, { pages: await pdfPages(readFileSync(join(set.dir, doc.file))), ms: performance.now() - started })
    }
    const results: Record<string, LeaseResult[]> = {}
    const localMs = new Map<string, number>()
    for (const route of routes) {
      results[route] = []
      for (const doc of truth.leases) {
        const { pages: p, ms: textMs } = pages.get(doc.file)!
        const started = performance.now()
        const a = await abstractLease(p, route)
        const elapsed = performance.now() - started
        if (route === 'rules') localMs.set(doc.file, elapsed)
        results[route].push(score(doc, a, invoices, textMs + a.model.latencyMs + (route === 'rules' ? elapsed : (localMs.get(doc.file) ?? 0))))
        process.stdout.write(a.model.live ? '+' : '.')
      }
      process.stdout.write(` ${set.id} ${route}\n`)
    }
    const docs = truth.leases
    report.sets.push({
      id: set.id,
      title: set.title,
      description: set.description,
      meta: {
        leases: docs.length,
        commercial: docs.filter((d) => d.leaseType === 'commercial').length,
        residential: docs.filter((d) => d.leaseType === 'residential').length,
        plantedIssues: docs.reduce((s, d) => s + d.issues.length, 0),
        plantedMismatches: truth.reconciliation.length,
        risks: docs.reduce((s, d) => s + d.risks.length, 0),
      },
      summaries: routes.map((r) => summarise(r, results[r], truth.reconciliation)),
      results,
    })
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'leases.md'), markdown(report) + '\n')
  writeFileSync(join(OUT_DIR, 'leases.json'), JSON.stringify(report, null, 2) + '\n')
  for (const set of report.sets) {
    console.log(`${set.title} (${set.meta.leases})`)
    for (const x of set.summaries) {
      console.log(
        `  ${ROUTE_NAMES[x.route].padEnd(8)} terms ${pct(x.fieldAccuracy.correct, x.fieldAccuracy.total).padStart(6)}  full ${x.leasesFullyCorrect}/${x.leases}  ` +
          `risks P ${(100 * x.risks.precision).toFixed(0)}% R ${(100 * x.risks.recall).toFixed(0)}%  recon ${x.reconciliation.found}/${x.reconciliation.planted}  ` +
          `median ${ms(x.medianLatencyMs)}  calls live ${x.modelCalls.live} cached ${x.modelCalls.cached}  cost/lease $${(x.costUsd / x.leases).toFixed(4)}`,
      )
    }
  }
  console.log(`Wrote ${join(OUT_DIR, 'leases.md')}`)
}

main().catch((e) => {
  if (e instanceof AiError) console.error(`\n${e.message}. Nothing was written; re-run later (finished calls are cached).`)
  else console.error(e)
  process.exitCode = 1
})
