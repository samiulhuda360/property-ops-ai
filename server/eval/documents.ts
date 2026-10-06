// Evaluates document extraction on two labelled synthetic sets: the 40 documents in the layouts the rules were written
// for (data/documents/truth.json) and 15 held-out documents in four other layouts (data/documents/heldout/truth.json).
// Runs every document through rules, the model alone, and the model with validation, then writes
// eval/results/documents.md and documents.json at the repo root.
//
//   npx tsx eval/documents.ts                                  (from server/; rules only without a key)
//   AI_API_KEY="$GEMINI_API_KEY" npx tsx eval/documents.ts     (all three methods; replies are cached on disk)
//   npx tsx eval/documents.ts --render                         (rebuild the .md from the saved .json)
//
// Reference data (properties, contractors, jobs, leases) is read from the seeded database in DATABASE_URL.
import 'dotenv/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AiError, aiConfig, aiEnabled } from '../src/ai/llm'
import { canonical, sameFieldValue } from '../src/documents/compare'
import { extractDocument, type Extraction } from '../src/documents/pipeline'
import { loadReferenceData } from '../src/documents/reference'
import { pdfText } from '../src/documents/text'
import { fieldNames, isAlarm, type Confidence, type DocumentKind, type InvoiceFields, type Method } from '../src/documents/types'
import type { InvoiceRef } from '../src/documents/validate'
import { prisma } from '../src/lib/prisma'

const DATA_DIR = resolve(__dirname, '../../data/documents')
const OUT_DIR = resolve(__dirname, '../../eval/results')
const METHOD_NAMES: Record<Method, string> = { rules: 'Rules', llm: 'Model', 'llm+validation': 'Model + validation' }

interface TruthDoc {
  file: string
  kind: DocumentKind
  layout: string
  fields: Record<string, unknown>
  issues: string[]
  note?: string
}

interface DocResult {
  file: string
  kind: DocumentKind
  detectedKind: DocumentKind
  fields: { field: string; correct: boolean; expected: unknown; got: unknown; confidence: Confidence }[]
  expectedIssues: string[]
  raisedIssues: string[]
  caught: string[]
  missed: string[]
  unexpected: string[]
  latencyMs: number
  calls: { live: number; cached: number; repaired: boolean }
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${((100 * n) / d).toFixed(1)}%`)
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const show = (field: string, v: unknown) => {
  const c = canonical(field, v)
  if (c === null) return 'nothing'
  if (['subtotal', 'gst', 'total', 'weeklyRent', 'bond'].includes(field) && typeof c === 'number') return `$${(c / 100).toFixed(2)}`
  if (field === 'lineItems' && Array.isArray(c)) return `${c.length} lines (${c.map((x) => (Number(x) / 100).toFixed(2)).join(', ')})`
  return typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
}

function score(doc: TruthDoc, ex: Extraction, latencyMs: number): DocResult {
  const fields = fieldNames(doc.kind).map((field) => {
    const got = ex.kind === doc.kind ? (ex.values as unknown as Record<string, unknown>)[field] : null
    return {
      field,
      correct: ex.kind === doc.kind && sameFieldValue(field, doc.fields[field], got),
      expected: doc.fields[field],
      got,
      confidence: ex.extracted[field]?.confidence ?? 'low',
    }
  })
  const raised: string[] = [...new Set(ex.issues.filter(isAlarm).map((i) => i.code))]
  return {
    file: doc.file,
    kind: doc.kind,
    detectedKind: ex.kind,
    fields,
    expectedIssues: doc.issues,
    raisedIssues: raised,
    caught: doc.issues.filter((c) => raised.includes(c)),
    missed: doc.issues.filter((c) => !raised.includes(c)),
    unexpected: raised.filter((c) => !doc.issues.includes(c)),
    latencyMs,
    calls: { live: ex.model.live, cached: ex.model.cached, repaired: ex.model.repaired },
  }
}

function summarise(method: Method, results: DocResult[]) {
  const allFields = results.flatMap((r) => r.fields)
  const perField: Record<string, { correct: number; total: number }> = {}
  for (const r of results) {
    for (const f of r.fields) {
      const key = `${r.kind}.${f.field}`
      perField[key] ??= { correct: 0, total: 0 }
      perField[key].total++
      if (f.correct) perField[key].correct++
    }
  }
  const byKind = (kind: DocumentKind) => results.filter((r) => r.kind === kind).flatMap((r) => r.fields)
  const planted = results.filter((r) => r.expectedIssues.length > 0)
  const clean = results.filter((r) => r.expectedIssues.length === 0)
  const confidence: Record<Confidence, { fields: number; correct: number }> = {
    high: { fields: 0, correct: 0 },
    medium: { fields: 0, correct: 0 },
    low: { fields: 0, correct: 0 },
  }
  for (const f of allFields) {
    confidence[f.confidence].fields++
    if (f.correct) confidence[f.confidence].correct++
  }
  return {
    method,
    documents: results.length,
    kindCorrect: results.filter((r) => r.kind === r.detectedKind).length,
    fieldAccuracy: {
      correct: allFields.filter((f) => f.correct).length,
      total: allFields.length,
      invoice: { correct: byKind('invoice').filter((f) => f.correct).length, total: byKind('invoice').length },
      lease: { correct: byKind('lease').filter((f) => f.correct).length, total: byKind('lease').length },
      perField,
    },
    documentsFullyCorrect: results.filter((r) => r.fields.every((f) => f.correct)).length,
    planted: {
      problems: planted.reduce((s, r) => s + r.expectedIssues.length, 0),
      caught: planted.reduce((s, r) => s + r.caught.length, 0),
      documents: planted.length,
      documentsFullyCaught: planted.filter((r) => r.missed.length === 0).length,
    },
    falseAlarms: {
      cleanDocuments: clean.length,
      cleanDocumentsFlagged: clean.filter((r) => r.raisedIssues.length > 0).length,
      extraIssuesOnPlantedDocuments: planted.reduce((s, r) => s + r.unexpected.length, 0),
    },
    medianLatencyMs: median(results.map((r) => r.latencyMs)),
    modelCalls: {
      live: results.reduce((s, r) => s + r.calls.live, 0),
      cached: results.reduce((s, r) => s + r.calls.cached, 0),
      repairs: results.filter((r) => r.calls.repaired).length,
    },
    confidence,
  }
}

type Summary = ReturnType<typeof summarise>

interface SetSpec {
  id: 'seen' | 'heldout'
  title: string
  dir: string
  description: string
}

const SETS: SetSpec[] = [
  {
    id: 'seen',
    title: 'Seen layouts',
    dir: DATA_DIR,
    description:
      'six invoice layouts (classic table, letter, receipt, water bill, insurance renewal, two-column) and two tenancy ' +
      'summary layouts. The rules and prompts were written with these layouts in view.',
  },
  {
    id: 'heldout',
    title: 'Held-out layouts',
    dir: join(DATA_DIR, 'heldout'),
    description:
      'four layouts made after the rules and prompts were fixed, and never used to change them: totals above the line ' +
      'items with dates written out ("the 3rd of September 2026"), a GST-inclusive shop invoice with "Amount payable" ' +
      'and "GST content" and no subtotal, a detailed layout with two-digit-year dates that includes a two-page invoice ' +
      'and a credit note, and a tenancy summary written as a letter.',
  },
]

interface SetMeta {
  documents: number
  invoices: number
  leases: number
  plantedDocs: number
  plantedProblems: number
  cleanDocs: number
}

interface SetReport {
  id: string
  title: string
  description: string
  meta: SetMeta
  summaries: Summary[]
  results: Record<string, DocResult[]>
}

interface Report {
  date: string
  model: string
  sets: SetReport[]
}

const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`)

function setSection(set: SetReport): string[] {
  const s = set.summaries
  const cols = s.map((x) => METHOD_NAMES[x.method])
  const row = (label: string, cells: string[]) => `| ${label} | ${cells.join(' | ')} |`
  const rule = `|---|${cols.map(() => '---:').join('|')}|`
  const m = set.meta
  const lines: string[] = []
  lines.push(`## ${set.title} (${m.documents})`, '')
  lines.push(
    `${m.invoices} supplier invoices and ${m.leases} tenancy summaries: ${set.description} ${m.plantedDocs} documents carry ` +
      `${m.plantedProblems} planted problems; the other ${m.cleanDocs} are clean.`,
    '',
  )
  lines.push(row('Metric', cols), rule)
  const frac = (c: number, t: number) => `${pct(c, t)} (${c}/${t})`
  lines.push(row('Field accuracy, all fields', s.map((x) => frac(x.fieldAccuracy.correct, x.fieldAccuracy.total))))
  lines.push(row('Field accuracy, invoices', s.map((x) => frac(x.fieldAccuracy.invoice.correct, x.fieldAccuracy.invoice.total))))
  lines.push(row('Field accuracy, tenancy summaries', s.map((x) => frac(x.fieldAccuracy.lease.correct, x.fieldAccuracy.lease.total))))
  lines.push(row('Documents fully correct', s.map((x) => `${x.documentsFullyCorrect}/${x.documents}`)))
  lines.push(row('Planted problems caught (recall)', s.map((x) => frac(x.planted.caught, x.planted.problems))))
  lines.push(row('Clean documents with a false alarm', s.map((x) => `${x.falseAlarms.cleanDocumentsFlagged}/${x.falseAlarms.cleanDocuments}`)))
  lines.push(row('Extra issues on planted documents', s.map((x) => String(x.falseAlarms.extraIssuesOnPlantedDocuments))))
  lines.push(row('Median latency per document', s.map((x) => ms(x.medianLatencyMs))))
  lines.push(row('Model calls this run: live / cached', s.map((x) => `${x.modelCalls.live} / ${x.modelCalls.cached}`)))
  lines.push(row('Documents that needed the repair call', s.map((x) => (x.method === 'llm+validation' ? String(x.modelCalls.repairs) : '–'))))
  lines.push('')
  if (s.length > 1 && new Set(s.map((x) => x.fieldAccuracy.correct)).size === 1) {
    lines.push(
      'The methods read the same share of fields correctly on this set, so it does not separate them on accuracy. ' +
        'The planted problems are caught by the business checks, which run after every method.',
      '',
    )
  }

  lines.push(`### ${set.title}: accuracy per field`, '', row('Field', cols), rule)
  for (const key of Object.keys(s[0].fieldAccuracy.perField)) {
    const [kind, field] = key.split('.')
    lines.push(row(`${kind === 'invoice' ? 'Invoice' : 'Summary'}: ${field}`, s.map((x) => {
      const f = x.fieldAccuracy.perField[key]
      return frac(f.correct, f.total)
    })))
  }
  lines.push('')

  const withModel = s.filter((x) => x.method !== 'rules')
  if (withModel.length) {
    lines.push(`### ${set.title}: confidence against correctness`, '')
    lines.push(row('Confidence', withModel.map((x) => METHOD_NAMES[x.method])), `|---|${withModel.map(() => '---:').join('|')}|`)
    for (const level of ['high', 'medium', 'low'] as Confidence[]) {
      lines.push(row(level, withModel.map((x) => {
        const c = x.confidence[level]
        return c.fields ? `${pct(c.correct, c.fields)} of ${c.fields} fields` : 'no fields'
      })))
    }
    lines.push('')
  }
  return lines
}

function markdown(report: Report): string {
  const lines: string[] = []
  lines.push('# Document extraction: evaluation', '')
  lines.push(
    `Two labelled synthetic sets of supplier invoices and tenancy summaries, each run through the rules, the model ` +
      `alone, and the model with validation. Run on ${report.date}${report.model ? ` with model \`${report.model}\`` : ''}.`,
    '',
  )
  for (const set of report.sets) lines.push(...setSection(set))

  lines.push('## How it is measured', '')
  lines.push(
    '- Each set goes through each method in the same order, starting from an empty document store, so a re-sent invoice is a duplicate of the one before it. Reference data (properties, contractors, maintenance jobs and quotes, leases) comes from the seeded demo database.',
    '- A field is correct when it equals the labelled value after normalising: dates to ISO, money to cents, addresses to lower case without punctuation (abbreviations such as Rd and Mt expanded, city and postcode dropped), GST and bank numbers to digits, supplier names without legal suffixes, line items compared by their amounts. A missing value is wrong unless the document has none. Labelled values are what the document prints: on the GST-inclusive shop invoices the line amounts include GST and there is no subtotal; on the credit note the amounts are negative.',
    '- A planted problem is caught when its issue (error or warning) is raised on that document. A false alarm is any error or warning on a clean document; notes marked info (for example "the job is still in progress") are context, not alarms. The credit note is labelled `credit_note`, an issue the checks have no rule for.',
    '- Latency per document: reading the PDF text, plus each model call\'s recorded latency (the same figure whether the reply came live or from the disk cache), plus the rules and checks. The latency of a call runs from its first attempt, so it includes any retry waits after rate-limit responses from the shared API key; the seen-set and held-out calls were made at different times. Live calls were spaced at least 2.5 s apart; that spacing is not counted.',
    '- Model + validation reuses the model-only call (the identical request is served from the cache) and adds one repair call when the checks fail.',
    '- The rules and the prompts were written with the seen layouts in view. The held-out layouts were made afterwards and have not been used to change either, so they show how each method copes with a supplier format it has not met.',
    '',
  )

  lines.push('## Items not handled correctly', '')
  for (const set of report.sets) {
    for (const summary of set.summaries) {
      const bad = set.results[summary.method].filter((r) => r.fields.some((f) => !f.correct) || r.missed.length || r.unexpected.length)
      lines.push(`### ${set.title}: ${METHOD_NAMES[summary.method]}`, '')
      if (!bad.length) {
        lines.push('Every field and every planted problem was handled correctly, with no false alarms.', '')
        continue
      }
      for (const r of bad) {
        const parts: string[] = []
        for (const f of r.fields.filter((x) => !x.correct)) parts.push(`${f.field}: expected ${show(f.field, f.expected)}, read ${show(f.field, f.got)}`)
        if (r.missed.length) parts.push(`missed ${r.missed.join(', ')}`)
        if (r.unexpected.length) parts.push(`raised ${r.unexpected.join(', ')} (not planted)`)
        lines.push(`- \`${r.file}\`: ${parts.join('; ')}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

/** --render rebuilds documents.md from the saved documents.json without reading or calling anything. */
function render() {
  const saved = JSON.parse(readFileSync(join(OUT_DIR, 'documents.json'), 'utf8')) as Report
  writeFileSync(join(OUT_DIR, 'documents.md'), markdown(saved) + '\n')
  console.log(`Rebuilt ${join(OUT_DIR, 'documents.md')} from documents.json`)
}

async function main() {
  if (process.argv.includes('--render')) return render()
  const user = await prisma.user.findUnique({ where: { email: 'demo@example.com' } })
  if (!user) throw new Error('The demo user is missing: run the seed first.')
  const base = await loadReferenceData(user.id)
  const methods: Method[] = aiEnabled() ? ['rules', 'llm', 'llm+validation'] : ['rules']
  if (!aiEnabled()) console.log('No model configured (AI_API_KEY empty or AI_DRIVER=off): evaluating the rules only.')

  const report: Report = { date: new Date().toLocaleDateString('en-CA'), model: aiEnabled() ? aiConfig().model : '', sets: [] }
  for (const set of SETS) {
    const truth = JSON.parse(readFileSync(join(set.dir, 'truth.json'), 'utf8')) as { documents: TruthDoc[] }
    const texts = new Map<string, { text: string; ms: number }>()
    for (const doc of truth.documents) {
      const started = performance.now()
      const text = await pdfText(readFileSync(join(set.dir, doc.file)))
      texts.set(doc.file, { text, ms: performance.now() - started })
    }

    const results: Record<string, DocResult[]> = {}
    // Local work (rules and checks) is timed on the rules run; model time is the calls' recorded latency, so waiting
    // between live calls doesn't count and cached replays report the original latency.
    const localMs = new Map<string, number>()
    for (const method of methods) {
      const seen: InvoiceRef[] = []
      results[method] = []
      for (const doc of truth.documents) {
        const { text, ms: textMs } = texts.get(doc.file)!
        const started = performance.now()
        const ex = await extractDocument(text, method, { ...base, invoices: [...seen] })
        if (method === 'rules') localMs.set(doc.file, performance.now() - started)
        results[method].push(score(doc, ex, textMs + ex.model.latencyMs + (localMs.get(doc.file) ?? 0)))
        const v = ex.values as InvoiceFields
        if (ex.kind === 'invoice' && v.invoiceNumber) {
          seen.push({ documentId: null, contractorId: ex.links.contractorId, supplierName: v.supplierName, invoiceNumber: v.invoiceNumber })
        }
        process.stdout.write(ex.model.live ? '+' : '.')
      }
      process.stdout.write(` ${set.id} ${method}\n`)
    }

    const docs = truth.documents
    report.sets.push({
      id: set.id,
      title: set.title,
      description: set.description,
      meta: {
        documents: docs.length,
        invoices: docs.filter((d) => d.kind === 'invoice').length,
        leases: docs.filter((d) => d.kind === 'lease').length,
        plantedDocs: docs.filter((d) => d.issues.length).length,
        plantedProblems: docs.reduce((s, d) => s + d.issues.length, 0),
        cleanDocs: docs.filter((d) => !d.issues.length).length,
      },
      summaries: methods.map((m) => summarise(m, results[m])),
      results,
    })
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'documents.md'), markdown(report) + '\n')
  writeFileSync(join(OUT_DIR, 'documents.json'), JSON.stringify(report, null, 2) + '\n')

  for (const set of report.sets) {
    console.log(`${set.title} (${set.meta.documents})`)
    for (const x of set.summaries) {
      console.log(
        `  ${METHOD_NAMES[x.method].padEnd(20)} fields ${pct(x.fieldAccuracy.correct, x.fieldAccuracy.total).padStart(6)}  ` +
          `docs ${x.documentsFullyCorrect}/${x.documents}  planted ${x.planted.caught}/${x.planted.problems}  ` +
          `false alarms ${x.falseAlarms.cleanDocumentsFlagged}/${x.falseAlarms.cleanDocuments}  ` +
          `median ${ms(x.medianLatencyMs)}  calls live ${x.modelCalls.live} cached ${x.modelCalls.cached}`,
      )
    }
  }
  console.log(`Wrote ${join(OUT_DIR, 'documents.md')}`)
}

main()
  .catch((e) => {
    if (e instanceof AiError) {
      console.error(`\n${e.message}. Nothing was written; re-run later (finished calls are cached).`)
    } else {
      console.error(e)
    }
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
