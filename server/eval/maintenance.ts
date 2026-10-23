// Evaluates maintenance triage on the 60 labelled tenant requests (data/maintenance/requests.json): the rules, the
// model alone and the shipped llm+rules route. Writes eval/results/maintenance.md and maintenance.json at the repo
// root: category and urgency accuracy (all, dev, held-out), whether every safety case was flagged urgent, safety-flag
// precision and recall, latency and the cost per request from the tokens the API reported.
//
//   npx tsx eval/maintenance.ts                                      (from server/; rules only without a key)
//   AI_API_KEY="$GEMINI_API_KEY" npx tsx eval/maintenance.ts         (all three routes; replies are cached on disk)
//   AI_DRIVER=replay npx tsx eval/maintenance.ts                     (all three routes from the committed cache, no key)
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { aiConfig, aiEnabled, setCallLogger } from '../src/ai/llm'
import { loadRequests, type LabelledRequest } from '../src/maintenance/demo'
import { triageRequest } from '../src/maintenance/pipeline'
import { SAFETY_FLAGS, type TriageMethod, type TriageOutcome } from '../src/maintenance/types'

const OUT_DIR = resolve(__dirname, '../../eval/results')
const METHODS: TriageMethod[] = ['rules', 'llm', 'llm+rules']
const NAMES: Record<TriageMethod, string> = { rules: 'Rules', llm: 'Model', 'llm+rules': 'Model + rules (shipped)' }
/** List price assumed for the cost column: USD per million tokens (Gemini 2.5 Flash-Lite, paid tier). */
const PRICE = { input: 0.1, output: 0.4 }

interface Row {
  id: string
  split: string
  category: boolean
  urgency: boolean
  safetyCase: boolean
  flaggedUrgent: boolean
  expectedSafety: string[]
  gotSafety: string[]
  latencyMs: number
  live: number
  cached: number
}

interface MethodResult {
  method: TriageMethod
  rows: Row[]
  inputTokens: number
  outputTokens: number
  live: number
  cached: number
  error: string | null
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${((100 * n) / d).toFixed(1)}%`)
const frac = (c: number, t: number) => `${pct(c, t)} (${c}/${t})`
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

function summarise(rows: Row[]) {
  const safetyCases = rows.filter((r) => r.safetyCase)
  let tp = 0
  let fp = 0
  let fn = 0
  for (const r of rows) {
    for (const f of SAFETY_FLAGS) {
      const e = r.expectedSafety.includes(f)
      const g = r.gotSafety.includes(f)
      if (e && g) tp++
      else if (!e && g) fp++
      else if (e && !g) fn++
    }
  }
  return {
    n: rows.length,
    category: rows.filter((r) => r.category).length,
    urgency: rows.filter((r) => r.urgency).length,
    safetyCases: safetyCases.length,
    safetyUrgent: safetyCases.filter((r) => r.flaggedUrgent).length,
    flagPrecision: tp + fp ? tp / (tp + fp) : 1,
    flagRecall: tp + fn ? tp / (tp + fn) : 1,
    falseUrgent: rows.filter((r) => !r.safetyCase && r.flaggedUrgent && !r.urgency).length,
    medianLatencyMs: median(rows.map((r) => r.latencyMs)),
  }
}

async function runMethod(method: TriageMethod, requests: LabelledRequest[]): Promise<MethodResult> {
  const rows: Row[] = []
  let inputTokens = 0
  let outputTokens = 0
  let live = 0
  let cached = 0
  setCallLogger((rec) => {
    inputTokens += rec.inputTokens ?? 0
    outputTokens += rec.outputTokens ?? 0
    if (!rec.error) (rec.cached ? cached++ : live++)
  })
  for (const r of requests) {
    const started = Date.now()
    let out: TriageOutcome
    try {
      out = await triageRequest({ text: r.text, photoNote: r.photoNote }, method)
    } catch (e) {
      return { method, rows, inputTokens, outputTokens, live, cached, error: e instanceof Error ? e.message : String(e) }
    }
    if (out.model.error && method !== 'rules') {
      return { method, rows, inputTokens, outputTokens, live, cached, error: out.model.error }
    }
    rows.push({
      id: r.id,
      split: r.split,
      category: out.category === r.labels.category,
      urgency: out.urgency === r.labels.urgency,
      safetyCase: r.labels.safety.length > 0,
      flaggedUrgent: out.urgency === 'urgent',
      expectedSafety: r.labels.safety,
      gotSafety: out.safety,
      latencyMs: Date.now() - started,
      live: out.model.live,
      cached: out.model.cached,
    })
    process.stdout.write(`${method} ${r.id} ${out.category}/${out.urgency}${out.safety.length ? ` [${out.safety.join(',')}]` : ''}${out.model.live ? ' (live)' : ''}\n`)
  }
  setCallLogger(null)
  return { method, rows, inputTokens, outputTokens, live, cached, error: null }
}

function render(results: MethodResult[], requests: LabelledRequest[]): string {
  const ok = results.filter((r) => !r.error)
  const lines: string[] = []
  lines.push('# Maintenance triage: evaluation', '')
  lines.push(
    `${requests.length} labelled tenant requests across the two demo companies (${requests.filter((r) => r.split === 'dev').length} used while writing the rules and prompt, ` +
      `${requests.filter((r) => r.split === 'heldout').length} held out). Each is labelled with a category, an urgency and the safety flags that apply. ` +
      `Model: \`${aiConfig().model}\`. The shipped route lets the model classify and write the scope while the rules keep the safety net: a safety pattern always makes the request urgent.`,
    '',
  )
  for (const split of ['all', 'dev', 'heldout']) {
    const label = split === 'all' ? 'All 60 requests' : split === 'dev' ? 'Development set' : 'Held-out set'
    const header = ['Metric', ...ok.map((r) => NAMES[r.method])]
    const sums = ok.map((r) => summarise(split === 'all' ? r.rows : r.rows.filter((x) => x.split === split)))
    const n = sums[0]?.n ?? 0
    lines.push(`## ${label} (${n})`, '', `| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`)
    lines.push(`| Category correct | ${sums.map((s) => frac(s.category, s.n)).join(' | ')} |`)
    lines.push(`| Urgency correct | ${sums.map((s) => frac(s.urgency, s.n)).join(' | ')} |`)
    lines.push(`| Safety cases flagged urgent | ${sums.map((s) => frac(s.safetyUrgent, s.safetyCases)).join(' | ')} |`)
    lines.push(`| Safety flags: precision / recall | ${sums.map((s) => `${pct(s.flagPrecision * 100, 100)} / ${pct(s.flagRecall * 100, 100)}`).join(' | ')} |`)
    lines.push(`| Non-safety requests wrongly made urgent | ${sums.map((s) => String(s.falseUrgent)).join(' | ')} |`)
    lines.push(`| Median time per request | ${sums.map((s) => (s.medianLatencyMs < 1000 ? `${s.medianLatencyMs} ms` : `${(s.medianLatencyMs / 1000).toFixed(1)} s`)).join(' | ')} |`)
    lines.push('')
  }
  lines.push('## Calls and cost', '')
  lines.push('| Route | Live calls | Cached calls | Input tokens | Output tokens | Cost per request at list price |', '|---|---|---|---|---|---|')
  for (const r of ok) {
    const cost = (r.inputTokens * PRICE.input + r.outputTokens * PRICE.output) / 1e6 / Math.max(1, r.rows.length)
    lines.push(`| ${NAMES[r.method]} | ${r.live} | ${r.cached} | ${r.inputTokens} | ${r.outputTokens} | $${cost.toFixed(4)} |`)
  }
  lines.push('', `Cost uses the tokens the API reported at $${PRICE.input} per million input tokens and $${PRICE.output} per million output tokens.`, '')
  const misses = ok.flatMap((r) => r.rows.filter((x) => !x.category || !x.urgency).map((x) => `${NAMES[r.method]}: ${x.id}${!x.category ? ' category' : ''}${!x.urgency ? ' urgency' : ''}`))
  if (misses.length) {
    lines.push('## Requests not fully correct', '', ...misses.map((m) => `- ${m}`), '')
  }
  for (const r of results.filter((x) => x.error)) lines.push(`Route ${NAMES[r.method]} did not finish: ${r.error}`, '')
  return lines.join('\n')
}

async function main() {
  const requests = loadRequests()
  const methods = aiEnabled() ? METHODS : (['rules'] as TriageMethod[])
  const results: MethodResult[] = []
  for (const m of methods) results.push(await runMethod(m, requests))
  mkdirSync(OUT_DIR, { recursive: true })
  const md = render(results, requests)
  writeFileSync(join(OUT_DIR, 'maintenance.md'), md + '\n')
  writeFileSync(
    join(OUT_DIR, 'maintenance.json'),
    JSON.stringify(
      results.map((r) => ({ method: r.method, error: r.error, live: r.live, cached: r.cached, inputTokens: r.inputTokens, outputTokens: r.outputTokens, all: summarise(r.rows), dev: summarise(r.rows.filter((x) => x.split === 'dev')), heldout: summarise(r.rows.filter((x) => x.split === 'heldout')), rows: r.rows })),
      null,
      2,
    ) + '\n',
  )
  console.log('\n' + md)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
