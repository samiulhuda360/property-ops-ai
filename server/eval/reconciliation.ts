// Evaluates rent reconciliation on the labelled synthetic September 2026 statement (data/bank/truth.json).
//
// Methods:
//   rules          the deterministic engine alone (what runs with AI off);
//   model only     the model classifies every line from the same portfolio context; its tenancy choices then go
//                  through the same ledger arithmetic, so only the matching differs;
//   rules + model  the engine, plus a model suggestion for each line it holds as unknown or ambiguous. Suggestions
//                  are never applied by the app; here they are scored, and the ledger a person would get by
//                  accepting them is reported separately.
//
// Run in server/:  AI_API_KEY="$GEMINI_API_KEY" npx tsx eval/reconciliation.ts
// Without a key only the rules are scored. Model calls go through the disk cache, spaced 2.5 s apart when live.
// Writes eval/results/reconciliation.md and eval/results/reconciliation.json at the repository root.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { aiConfig, aiEnabled, chat, setCallLogger, type JsonSchema } from '../src/ai/llm'
import { suggestForLine, type SuggestionInput } from '../src/reconciliation/ai'
import { allocate, computeArrears, outstanding, replayLease } from '../src/reconciliation/allocate'
import { parseStatement } from '../src/reconciliation/csv'
import { reconcile } from '../src/reconciliation/engine'
import { loadTruth, readDemoStatement, snapshotFromTruth, type TruthLine } from '../src/reconciliation/fixture'
import { round2 } from '../src/reconciliation/text'
import { EXCEPTION_CODES, type ExceptionCode, type LineResult, type RentPayment } from '../src/reconciliation/types'

const RESULTS_DIR = resolve(__dirname, '..', '..', 'eval', 'results')
const truth = loadTruth()
const lines = parseStatement(readDemoStatement()).lines
const fx = snapshotFromTruth(truth)
const HELD = new Set(['duplicate', 'unknown_payer', 'ambiguous', 'payment_to_ended_lease'])

const calls = { live: 0, cached: 0, failed: 0 }
setCallLogger((c) => {
  if (c.error) calls.failed++
  else if (c.cached) calls.cached++
  else calls.live++
})

/** One method's answer for a line, in truth.json's vocabulary. */
interface Prediction {
  row: number
  type: string
  lease: string | null
  job: string | null
  exception: ExceptionCode | null
}

function fromRules(r: LineResult): Prediction {
  return {
    row: r.row,
    type: r.matchType ?? 'unknown',
    lease: r.matchType === 'rent' || r.matchType === 'refund' || r.exception === 'duplicate' ? fx.leaseCode(r.leaseId) : null,
    job: fx.jobKey(r.jobId),
    exception: r.exception,
  }
}

const sameTarget = (p: Prediction, t: TruthLine) => {
  const e = t.expected
  if (p.type !== e.type) return false
  if (e.type === 'rent' || e.type === 'refund') return p.lease === e.lease
  if (e.type === 'contractor') return p.job === e.job
  return true
}

/** Correct when the line is classified as expected, or (for a line a person must decide) given its real answer. */
function lineCorrect(p: Prediction, t: TruthLine): boolean {
  if (sameTarget(p, t)) return true
  return Boolean(t.answer?.lease && p.lease === t.answer.lease && p.type === 'rent')
}

function exceptionScores(preds: Prediction[]) {
  const per = EXCEPTION_CODES.map((code) => {
    let tp = 0
    let fp = 0
    let fn = 0
    for (const t of truth.lines) {
      const p = preds.find((x) => x.row === t.row)!
      const predicted = p.exception === code
      const expected = t.expected.exception === code
      if (predicted && expected) tp++
      else if (predicted) fp++
      else if (expected) fn++
    }
    return { reason: code, expected: tp + fn, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null }
  })
  const tp = per.reduce((s, r) => s + r.tp, 0)
  const fp = per.reduce((s, r) => s + r.fp, 0)
  const fn = per.reduce((s, r) => s + r.fn, 0)
  return { per, micro: { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0 } }
}

/** September rent covered per tenancy and week, from a set of payments after allocation. */
function coverage(payments: RentPayment[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const p of payments) {
    if (p.dueDate < truth.period.start) continue
    const code = fx.leaseCode(p.leaseId)!
    out[code] = { ...(out[code] ?? {}), [p.dueDate]: round2(p.covered) }
  }
  return out
}

function moneyScore(actual: Record<string, Record<string, number>>, expected: Record<string, Record<string, number>>) {
  let correct = 0
  let total = 0
  let misallocated = 0
  let weeksRight = 0
  let weeks = 0
  for (const [code, byWeek] of Object.entries(expected)) {
    for (const [week, amount] of Object.entries(byWeek)) {
      const got = actual[code]?.[week] ?? 0
      correct += Math.min(got, amount)
      total += amount
      misallocated += Math.max(0, got - amount)
      weeks++
      if (Math.abs(got - amount) < 0.005) weeksRight++
    }
  }
  return { correct: round2(correct), total: round2(total), share: total ? correct / total : 0, misallocated: round2(misallocated), weeksRight, weeks }
}

function arrearsScore(payments: RentPayment[], expected: { lease: string; amount: number }[]) {
  const found = computeArrears(fx.snapshot.leases, payments, truth.period.end).map((a) => ({ lease: fx.leaseCode(a.leaseId)!, amount: a.total }))
  const exact = found.filter((f) => expected.some((e) => e.lease === f.lease && Math.abs(e.amount - f.amount) < 0.005)).length
  return {
    found,
    expected,
    exact,
    missed: expected.filter((e) => !found.some((f) => f.lease === e.lease)).map((e) => e.lease),
    extra: found.filter((f) => !expected.some((e) => e.lease === f.lease)).map((f) => f.lease),
  }
}

/** Replays every tenancy from the given (line, tenancy) assignments, like the app's ledger. */
function ledgerFor(assign: { row: number; date: string; amount: number; lease: string }[]): RentPayment[] {
  const out: RentPayment[] = []
  for (const lease of fx.snapshot.leases) {
    const own = fx.snapshot.payments.filter((p) => p.leaseId === lease.id)
    const replay = replayLease(
      lease.weeklyRent,
      own.map((p) => ({ ...p, opening: p.covered > 0 })),
      assign.filter((a) => a.lease === lease.propertyCode).map((a) => ({ key: a.row, date: a.date, amount: a.amount, order: a.row })),
    )
    out.push(...replay.payments)
  }
  return out
}

function describeMiss(p: Prediction, t: TruthLine): string {
  const exp = `${t.expected.type}${t.expected.lease ? ` ${t.expected.lease}` : ''}${t.expected.job ? ` (${t.expected.job})` : ''}${t.expected.exception ? `, ${t.expected.exception}` : ''}`
  const got = `${p.type}${p.lease ? ` ${p.lease}` : ''}${p.job ? ` (${p.job})` : ''}${p.exception ? `, ${p.exception}` : ''}`
  return `Line ${t.row} (${t.payee || 'bank'} ${t.amount}): expected ${exp}; got ${got}`
}

function score(name: string, preds: Prediction[], payments: RentPayment[]) {
  const correct = truth.lines.filter((t) => lineCorrect(preds.find((p) => p.row === t.row)!, t))
  const misses = truth.lines
    .filter((t) => !correct.includes(t) || preds.find((p) => p.row === t.row)!.exception !== t.expected.exception)
    .map((t) => describeMiss(preds.find((p) => p.row === t.row)!, t))
  return {
    method: name,
    matchAccuracy: correct.length / truth.lines.length,
    linesCorrect: correct.length,
    lines: truth.lines.length,
    exceptions: exceptionScores(preds),
    arrears: arrearsScore(payments, truth.arrears.afterAutomatic),
    money: moneyScore(coverage(payments), truth.rentPaidByWeek.afterAutomatic),
    misses,
  }
}

// ---- Rules ----

function runRules() {
  const started = Date.now()
  const out = reconcile(lines, fx.snapshot)
  return { out, ms: Date.now() - started, scored: score('Rules only', out.results.map(fromRules), out.payments) }
}

// ---- Model only ----

const TYPES = ['rent', 'contractor', 'bond', 'refund', 'fee', 'transfer', 'other', 'unknown']
const MODEL_SCHEMA: JsonSchema = {
  name: 'statement_classification',
  schema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            row: { type: 'integer' },
            type: { type: 'string', enum: TYPES },
            tenancy: { type: 'string', description: 'Property code of the tenancy for rent or refund lines, else NONE' },
            job: { type: 'string', description: 'Job key exactly as listed for contractor lines, else NONE' },
            exception: { type: 'string', enum: [...EXCEPTION_CODES, 'none'] },
          },
          required: ['row', 'type', 'tenancy', 'job', 'exception'],
        },
      },
    },
    required: ['lines'],
  },
}

const MODEL_SYSTEM = [
  'You reconcile the trust account bank statement of a New Zealand property manager.',
  'Classify each requested line. type: rent (money for a tenancy), contractor (paid to or received from a contractor),',
  'bond, refund (money back to a tenant), fee (bank fee), transfer, other, or unknown (cannot tell who paid).',
  'tenancy: the property code for rent and refund lines; job: the job key for contractor lines; otherwise NONE.',
  'exception, when a person must look: underpaid (less than the weekly rent and rent left owing), overpaid (more than the rent',
  'due, leaving credit), duplicate (identical to an earlier line), unknown_payer, ambiguous (evidence points to more than one',
  'tenancy or job), payment_to_ended_lease, no_matching_job (contractor payment matching none of its jobs),',
  'amount_differs_from_quote; else none. A whole number of weeks of rent paid at once is not overpaid.',
  'Use only the tenancies and jobs listed. Reply with JSON only.',
].join(' ')

function modelContext() {
  return {
    statementPeriod: truth.period,
    tenancies: truth.portfolio.leases.map((l) => ({
      code: l.code,
      tenant: `${l.tenant.firstName} ${l.tenant.lastName}`,
      address: l.address,
      weeklyRent: l.weeklyRent,
      rentReference: l.rentReference,
      status: l.status,
      endDate: l.endDate,
      rentDueInPeriod: l.payments.filter((p) => p.dueDate >= truth.period.start).map((p) => p.dueDate),
    })),
    vacantProperties: truth.portfolio.vacantProperties,
    contractors: truth.portfolio.contractors.map((c) => c.name),
    jobs: truth.portfolio.jobs.map((j) => ({ key: j.key, contractor: j.contractor, status: j.status, quote: j.quoteAmount })),
    statement: lines.map((l) => ({ row: l.row, date: l.date, amount: l.amount, payee: l.payee, particulars: l.particulars, code: l.code, reference: l.reference, type: l.tranType })),
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let lastLive = 0
async function spacedChat<T>(req: Parameters<typeof chat>[0]) {
  const wait = lastLive + 2600 - Date.now()
  if (wait > 0) await sleep(wait)
  const before = calls.live
  const result = await chat<T>(req)
  if (calls.live > before) lastLive = Date.now()
  return result
}

async function runModelOnly() {
  const context = JSON.stringify(modelContext())
  const preds = new Map<number, Prediction>()
  const failures: string[] = []
  const codes = new Set(truth.portfolio.leases.map((l) => l.code))
  const jobs = new Set(truth.portfolio.jobs.map((j) => j.key))
  for (let start = 1; start <= lines.length; start += 10) {
    const end = Math.min(lines.length, start + 9)
    try {
      const res = await spacedChat<{ lines: { row: number; type: string; tenancy: string; job: string; exception: string }[] }>({
        feature: 'rent_reconciliation_eval',
        system: MODEL_SYSTEM,
        user: `${context}\n\nClassify statement rows ${start} to ${end}.`,
        schema: MODEL_SCHEMA,
        maxTokens: 2500,
      })
      for (const l of res.json?.lines ?? []) {
        if (l.row < start || l.row > end) continue
        const tenancy = l.tenancy?.toUpperCase()
        preds.set(l.row, {
          row: l.row,
          type: TYPES.includes(l.type) ? l.type : 'unknown',
          lease: tenancy && codes.has(tenancy) ? tenancy : null,
          job: jobs.has(l.job) ? l.job : null,
          exception: (EXCEPTION_CODES as readonly string[]).includes(l.exception) ? (l.exception as ExceptionCode) : null,
        })
      }
    } catch (e) {
      failures.push(`rows ${start}-${end}: ${e instanceof Error ? e.message : e}`)
    }
  }
  const all = lines.map((l) => preds.get(l.row) ?? { row: l.row, type: 'unknown', lease: null, job: null, exception: null })
  const missingRows = lines.filter((l) => !preds.has(l.row)).map((l) => l.row)
  // The model's tenancy choices go through the same ledger arithmetic as the rules.
  const payments = fx.snapshot.payments.map((p) => ({ ...p }))
  for (const line of [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row)) {
    const p = all.find((x) => x.row === line.row)!
    if (p.type !== 'rent' || !p.lease || (p.exception && HELD.has(p.exception)) || line.amount <= 0) continue
    const lease = fx.snapshot.leases.find((l) => l.propertyCode === p.lease)!
    allocate(line.amount, line.date, lease.weeklyRent, payments.filter((x) => x.leaseId === lease.id))
  }
  return { scored: score('Model only', all, payments), failures, missingRows }
}

// ---- Rules + model suggestions ----

async function runRulesWithSuggestions(out: ReturnType<typeof reconcile>) {
  const held = out.results.filter((r) => r.exception === 'unknown_payer' || (r.exception === 'ambiguous' && r.matchType === 'rent'))
  const owing = (leaseId: number) =>
    round2(out.payments.filter((p) => p.leaseId === leaseId && p.dueDate <= truth.period.end).reduce((s, p) => s + outstanding(p), 0))
  const credit = (leaseId: number) => round2(out.results.filter((r) => r.leaseId === leaseId && r.allocatable).reduce((s, r) => s + r.credit, 0))
  const suggestions = []
  for (const r of held) {
    const line = lines.find((l) => l.row === r.row)!
    const input: SuggestionInput = {
      line,
      tenancies: fx.snapshot.leases.map((l) => ({
        code: l.propertyCode!,
        tenant: `${l.tenantFirstName} ${l.tenantLastName}`,
        address: l.address,
        weeklyRent: l.weeklyRent,
        rentReference: l.rentReference,
        status: l.status,
        endDate: l.endDate,
        owingAtStatementEnd: owing(l.id),
        creditHeld: credit(l.id),
      })),
      payersSeen: out.results
        .filter((x) => x.allocatable && x.leaseId !== null && x.row !== r.row)
        .map((x) => {
          const l = lines.find((y) => y.row === x.row)!
          return { code: fx.leaseCode(x.leaseId)!, payer: l.payee, reference: [l.particulars, l.code, l.reference].filter(Boolean).join(' / '), date: l.date, amount: l.amount }
        }),
      rules: { exception: r.exception!, explanation: r.explanation, candidates: r.candidates.map((c) => `${c.label}: ${c.why}`) },
    }
    const s = await suggestForLine(input)
    const t = truth.lines.find((x) => x.row === r.row)!
    const right = s.status === 'ok' && (t.answer?.lease ?? null) === s.tenancy
    suggestions.push({ row: r.row, payee: line.payee, amount: line.amount, rules: r.exception, answer: t.answer, suggestion: s, right })
  }
  // The ledger a person would get by accepting every suggestion that names a tenancy.
  const assign = out.results
    .filter((r) => r.allocatable && r.leaseId !== null)
    .map((r) => ({ row: r.row, date: lines[r.row - 1].date, amount: lines[r.row - 1].amount, lease: fx.leaseCode(r.leaseId)! }))
  for (const s of suggestions) {
    if (s.suggestion.status === 'ok' && s.suggestion.tenancy) {
      assign.push({ row: s.row, date: lines[s.row - 1].date, amount: s.amount, lease: s.suggestion.tenancy })
    }
  }
  const accepted = ledgerFor(assign)
  return {
    suggestions,
    right: suggestions.filter((s) => s.right).length,
    ifAccepted: {
      arrears: arrearsScore(accepted, truth.arrears.afterReview),
      money: moneyScore(coverage(accepted), truth.rentPaidByWeek.afterReview),
    },
  }
}

// ---- Report ----

const pct = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 1000) / 10}%`)

function table(rows: string[][]): string {
  return [rows[0], rows[0].map(() => '---'), ...rows.slice(1)].map((r) => `| ${r.join(' | ')} |`).join('\n')
}

async function main() {
  const rules = runRules()
  const ai = aiEnabled()
  const model = ai ? await runModelOnly() : null
  const assisted = ai ? await runRulesWithSuggestions(rules.out) : null

  const methods = [rules.scored, ...(model ? [model.scored] : [])]
  const metricRows = [
    ['Method', 'Match accuracy', 'Exception precision', 'Exception recall', 'Arrears found (exact / expected, extra)', 'Rent money correctly allocated', 'Weeks right', 'Model calls'],
    ...methods.map((m) => [
      m.method,
      `${pct(m.matchAccuracy)} (${m.linesCorrect}/${m.lines})`,
      pct(m.exceptions.micro.precision),
      pct(m.exceptions.micro.recall),
      `${m.arrears.exact}/${m.arrears.expected.length}, ${m.arrears.extra.length}`,
      `${pct(m.money.share)} (${m.money.correct}/${m.money.total}; ${m.money.misallocated} misallocated)`,
      `${m.money.weeksRight}/${m.money.weeks}`,
      m.method === 'Model only' ? '5 (batches of 10 lines)' : '0',
    ]),
  ]
  if (assisted) {
    metricRows.push([
      'Rules + model suggestions',
      `${pct(rules.scored.matchAccuracy)} (suggestions are not applied)`,
      pct(rules.scored.exceptions.micro.precision),
      pct(rules.scored.exceptions.micro.recall),
      `${rules.scored.arrears.exact}/${rules.scored.arrears.expected.length}, ${rules.scored.arrears.extra.length}`,
      pct(rules.scored.money.share),
      `${rules.scored.money.weeksRight}/${rules.scored.money.weeks}`,
      `${assisted.suggestions.length} (one per held line)`,
    ])
  }

  const reasonRows = [
    ['Reason', 'Expected', ...methods.flatMap((m) => [`${m.method} precision`, `${m.method} recall`])],
    ...EXCEPTION_CODES.map((code) => [
      code,
      String(rules.scored.exceptions.per.find((r) => r.reason === code)!.expected),
      ...methods.flatMap((m) => {
        const r = m.exceptions.per.find((x) => x.reason === code)!
        return [`${pct(r.precision)} (${r.tp}/${r.tp + r.fp})`, `${pct(r.recall)} (${r.tp}/${r.expected})`]
      }),
    ]),
  ]

  const md: string[] = []
  md.push('# Evaluation: rent reconciliation', '')
  md.push(
    `Run on ${new Date().toISOString().slice(0, 10)} against the labelled synthetic statement \`data/bank/2026-09-statement.csv\` ` +
      `(${truth.totals.lines} lines, ${truth.totals.exceptions} planted exceptions, ground truth in \`data/bank/truth.json\`). ` +
      `Model: ${ai ? `\`${aiConfig().model}\`` : 'not run (AI off)'}.`,
    '',
  )
  md.push('## How it is measured', '')
  md.push(
    '- **Match accuracy:** a line is right when its type and target are right: the tenancy for rent and refunds, the job for contractor payments, the category otherwise. A line a person must decide (unknown or ambiguous) is right when it is held, or when it names the tenancy it really belongs to.',
    '- **Exception detection:** precision and recall of the reason code per line, against the planted exceptions.',
    '- **Arrears:** tenancies with rent owing at 30/09/2026 after the automatic pass, compared with the expected amounts; "extra" counts tenancies reported in arrears that should not be.',
    '- **Rent money correctly allocated:** for every tenancy and September week, the smaller of the expected and the allocated amount, summed and divided by the expected total. Misallocated money is money put on a week beyond what it should have received.',
    '- **Model only:** the model sees the same portfolio (tenancies, rents, rent references, jobs and quotes) and the whole statement, and classifies it in batches of 10 lines. Its tenancy choices go through the same ledger arithmetic as the rules, so the comparison is about matching, not arithmetic.',
    '- **Limits of the set:** the statement is synthetic and was written together with the matching policy, so a perfect rules score shows that every planted case is covered, not how the rules would do on an unseen export. Each reason has one or two examples, so per-reason figures move in large steps.',
    '- **Rules + model suggestions:** the rules run unchanged; the model is asked only about the lines they hold as unknown payer or ambiguous. The app shows its answer as a suggestion and never applies it, so the automatic numbers equal the rules. The suggestion accuracy and the ledger a person would get by accepting every suggestion are reported separately.',
    '',
  )
  md.push('## Results', '', table(metricRows), '')
  md.push(
    `Live model calls in this run: ${calls.live} (cache hits: ${calls.cached}, failed: ${calls.failed}). Rules-only time for the whole statement: ${rules.ms} ms.`,
    '',
  )
  md.push('### Exception detection by reason', '', table(reasonRows), '')
  if (assisted) {
    md.push('### Model suggestions for the lines the rules held', '')
    md.push(
      table([
        ['Line', 'Payee', 'Amount', 'Rules', 'Real answer', 'Suggestion', 'Right'],
        ...assisted.suggestions.map((s) => [
          String(s.row),
          s.payee,
          String(s.amount),
          s.rules ?? '',
          s.answer?.lease ?? `none (${s.answer?.category ?? '?'})`,
          s.suggestion.status === 'ok' ? `${s.suggestion.tenancy ?? 'none'}: ${s.suggestion.reason.replace(/\|/g, '/')}` : `${s.suggestion.status}: ${s.suggestion.error ?? ''}`,
          s.right ? 'yes' : 'no',
        ]),
      ]),
      '',
    )
    md.push(
      `Suggestions right: ${assisted.right}/${assisted.suggestions.length}. If a person accepted every suggestion naming a tenancy, ` +
        `arrears would match the expected after-review arrears for ${assisted.ifAccepted.arrears.exact}/${assisted.ifAccepted.arrears.expected.length} tenancies ` +
        `(extra: ${assisted.ifAccepted.arrears.extra.join(', ') || 'none'}), and ${pct(assisted.ifAccepted.money.share)} of the after-review rent money would be on the right weeks ` +
        `(${assisted.ifAccepted.money.misallocated} misallocated).`,
      '',
    )
  }
  md.push('## Arrears at 30/09/2026', '')
  md.push(
    table([
      ['Tenancy', 'Expected (automatic pass)', ...methods.map((m) => m.method)],
      ...[...new Set([...truth.arrears.afterAutomatic.map((a) => a.lease), ...methods.flatMap((m) => m.arrears.found.map((f) => f.lease))])].map((lease) => [
        lease,
        String(truth.arrears.afterAutomatic.find((a) => a.lease === lease)?.amount ?? 0),
        ...methods.map((m) => String(m.arrears.found.find((f) => f.lease === lease)?.amount ?? 0)),
      ]),
    ]),
    '',
  )
  md.push(
    "TAK9 (Sophie Clarke) is expected in arrears after the automatic pass because her partner's unreferenced payment is held as ambiguous until a person assigns it; after review only ONE3 ($50) and NLN11 ($1,080) remain.",
    '',
  )
  md.push('## Items not handled correctly', '')
  for (const m of methods) {
    md.push(`**${m.method}:** ${m.misses.length === 0 ? 'none.' : ''}`, '')
    for (const miss of m.misses) md.push(`- ${miss}`)
    if (m.misses.length) md.push('')
  }
  if (assisted) {
    const wrong = assisted.suggestions.filter((s) => !s.right)
    md.push(`**Model suggestions:** ${wrong.length === 0 ? 'none.' : ''}`, '')
    for (const s of wrong) md.push(`- Line ${s.row} (${s.payee} ${s.amount}): answer ${s.answer?.lease ?? 'none'}; suggested ${s.suggestion.tenancy ?? 'none'} (${s.suggestion.status})`)
    md.push('')
  }
  if (model && (model.failures.length || model.missingRows.length)) {
    md.push(`Model-only batches that failed: ${model.failures.join('; ') || 'none'}. Rows the model did not return: ${model.missingRows.join(', ') || 'none'}.`, '')
  }
  md.push('## Reproduce', '', '```bash', 'cd server', 'npx tsx scripts/generate-bank.ts                         # the statement and truth.json', 'AI_API_KEY="$GEMINI_API_KEY" npx tsx eval/reconciliation.ts  # or without the key: rules only', '```', '')

  mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(join(RESULTS_DIR, 'reconciliation.md'), md.join('\n'))
  writeFileSync(
    join(RESULTS_DIR, 'reconciliation.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        model: ai ? aiConfig().model : null,
        dataset: { statement: 'data/bank/2026-09-statement.csv', lines: truth.totals.lines, plantedExceptions: truth.totals.exceptions },
        calls,
        methods,
        modelOnly: model ? { failures: model.failures, missingRows: model.missingRows } : null,
        rulesWithSuggestions: assisted,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(md.join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
