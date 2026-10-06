// Evaluates the tenant inbox triage on the labelled synthetic emails: the 60-email development set
// (data/inbox/emails.json) and the 30-email held-out set (data/inbox/emails-holdout.json).
//
//   cd server
//   AI_API_KEY="$GEMINI_API_KEY" npx tsx eval/inbox.ts      # all three methods (model calls go through the disk cache)
//   npx tsx eval/inbox.ts                                    # rules only, when no key is set
//
// Methods:
// - rules only: keyword rules, template replies (what runs with AI_DRIVER=off);
// - model only: the model's raw JSON, with no rules or guards applied;
// - model + rules and guards: the shipped pipeline (the same model call, then the rules and guards).
// The demo portfolio (tenants, properties, existing maintenance jobs) is read from DATABASE_URL; nothing is written
// to the database. Results go to eval/results/inbox.md and eval/results/inbox.json at the repository root.
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { aiConfig, aiEnabled, setCallLogger } from '../src/ai/llm'
import { loadSampleEmails, type SampleEmail } from '../src/inbox/data'
import { loadDirectory } from '../src/inbox/link'
import { buildTriageRequest, callTriageModel } from '../src/inbox/model'
import { clauseExists } from '../src/inbox/terms'
import { findDuplicate, reporterLabel, ticketDescription, type ExistingTicket } from '../src/inbox/tickets'
import { analyse, combinedTriage, modelOnlyTriage, rulesTriage, type TriageResult } from '../src/inbox/triage'
import type { EmailInput } from '../src/inbox/types'
import { prisma } from '../src/lib/prisma'

type MethodKey = 'rules' | 'model' | 'shipped'
const METHOD_NAMES: Record<MethodKey, string> = {
  rules: 'Rules only',
  model: 'Model only',
  shipped: 'Model + rules and guards (shipped)',
}

type TicketOutcome = 'created' | 'linked' | 'none' | 'no_property'

interface Prediction {
  available: boolean
  category: string | null
  urgency: string | null
  tenantEmail: string | null | undefined // undefined: the method doesn't link
  propertyCode: string | null | undefined
  needsPerson: boolean | null
  ticket: boolean | null
  ticketOutcome: TicketOutcome | null
  cited: number[]
  invalidCitations: number[]
  promiseHits: number
  removedSentences: string[]
  reply: string
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${n}/${d} (${Math.round((100 * n) / d)}%)`)

function emailInput(e: SampleEmail): EmailInput {
  return { from: e.from, subject: e.subject, text: e.text, receivedAt: new Date(e.receivedAt) }
}

/** Mirrors the pipeline's job decision without the database: duplicates are checked against an in-memory list. */
function ticketDecision(store: Map<number, ExistingTicket[]>, email: EmailInput, r: TriageResult, nextId: { n: number }): TicketOutcome {
  if (!r.maintenance.isIssue) return 'none'
  if (!r.link.property) return 'no_property'
  const candidates = store.get(r.link.property.id) ?? []
  if (findDuplicate({ title: r.maintenance.title, description: r.maintenance.description, subject: email.subject }, email.receivedAt, candidates)) {
    return 'linked'
  }
  candidates.push({
    id: nextId.n--,
    title: r.maintenance.title,
    description: ticketDescription(r.maintenance.description, email.subject, reporterLabel(r.link)),
    status: 'open',
    createdAt: email.receivedAt,
  })
  store.set(r.link.property.id, candidates)
  return 'created'
}

function predictionOf(r: TriageResult, method: MethodKey, ticket: TicketOutcome | null, codeOf: (id: number) => string | null): Prediction {
  const allCited = [...r.replyDraft.matchAll(/§\s?(\d{1,3})/g)].map((m) => Number(m[1]))
  return {
    available: true,
    category: r.category,
    urgency: r.urgency,
    tenantEmail: method === 'model' ? undefined : r.link.tenant?.email ?? null,
    propertyCode: method === 'model' ? undefined : r.link.property ? codeOf(r.link.property.id) : null,
    needsPerson: r.needsPerson,
    ticket: method === 'model' ? r.maintenance.isIssue : ticket === 'created',
    ticketOutcome: ticket,
    cited: [...new Set(allCited)].filter(clauseExists),
    invalidCitations: [...new Set(allCited)].filter((n) => !clauseExists(n)),
    promiseHits: r.promiseHits,
    removedSentences: r.removedSentences.map((s) => s.sentence),
    reply: r.replyDraft,
  }
}

const missing: Prediction = {
  available: false,
  category: null,
  urgency: null,
  tenantEmail: null,
  propertyCode: null,
  needsPerson: null,
  ticket: null,
  ticketOutcome: null,
  cited: [],
  invalidCitations: [],
  promiseHits: 0,
  removedSentences: [],
  reply: '',
}

interface Metric {
  key: string
  label: string
  correct: number
  total: number
  value: string
}

function metricsFor(emails: SampleEmail[], preds: Prediction[], method: MethodKey) {
  const rows: Metric[] = []
  const add = (key: string, label: string, pairs: boolean[] | null) => {
    if (pairs === null) {
      rows.push({ key, label, correct: 0, total: 0, value: 'n/a' })
      return
    }
    const correct = pairs.filter(Boolean).length
    rows.push({ key, label, correct, total: pairs.length, value: pct(correct, pairs.length) })
  }
  const idx = emails.map((_, i) => i)
  add('category', 'Category accuracy', idx.map((i) => preds[i].category === emails[i].labels.category))
  add('urgency', 'Urgency accuracy (4 levels)', idx.map((i) => preds[i].urgency === emails[i].labels.urgency))
  const urgent = idx.filter((i) => emails[i].labels.urgency === 'urgent')
  add('urgent_recall', 'Urgent recall (urgent emails marked urgent)', urgent.map((i) => preds[i].urgency === 'urgent'))
  const flaggedUrgent = idx.filter((i) => preds[i].urgency === 'urgent')
  add('urgent_precision', 'Urgent precision (marked urgent that are urgent)', flaggedUrgent.map((i) => emails[i].labels.urgency === 'urgent'))
  add('tenant', 'Tenant linking', method === 'model' ? null : idx.map((i) => (preds[i].tenantEmail ?? null) === emails[i].labels.tenant_email))
  add('property', 'Property linking', method === 'model' ? null : idx.map((i) => (preds[i].propertyCode ?? null) === emails[i].labels.property_code))
  add('needs_person', 'Needs-a-person accuracy', idx.map((i) => preds[i].needsPerson === emails[i].labels.needs_person))
  const np = idx.filter((i) => emails[i].labels.needs_person)
  add('needs_person_recall', 'Needs-a-person recall', np.map((i) => preds[i].needsPerson === true))
  add('ticket', 'Correct maintenance job decision', idx.map((i) => preds[i].ticket === emails[i].labels.should_create_ticket))
  const withClause = idx.filter((i) => emails[i].labels.expected_clause !== null)
  add(
    'clause',
    'Reply cites the expected clause',
    withClause.map((i) => preds[i].cited.includes(emails[i].labels.expected_clause!) && preds[i].invalidCitations.length === 0),
  )
  const invalid = idx.filter((i) => preds[i].invalidCitations.length > 0).length
  rows.push({ key: 'invalid_citations', label: "Replies citing a clause that doesn't exist", correct: invalid, total: emails.length, value: String(invalid) })
  const promises = idx.filter((i) => preds[i].promiseHits > 0).length
  const promiseLabel = 'Drafts with a promise (the shipped guard removes it)'
  rows.push({ key: 'promise_hits', label: promiseLabel, correct: promises, total: emails.length, value: String(promises) })
  return rows
}

interface Miss {
  id: string
  subject: string
  issues: string[]
}

function missesFor(emails: SampleEmail[], preds: Prediction[], method: MethodKey): Miss[] {
  const out: Miss[] = []
  emails.forEach((e, i) => {
    const p = preds[i]
    const l = e.labels
    const issues: string[] = []
    if (!p.available) {
      issues.push('no model output')
    } else {
      if (p.category !== l.category) issues.push(`category: expected ${l.category}, got ${p.category}`)
      if (p.urgency !== l.urgency) issues.push(`urgency: expected ${l.urgency}, got ${p.urgency}`)
      if (method !== 'model' && (p.tenantEmail ?? null) !== l.tenant_email) issues.push(`tenant: expected ${l.tenant_email ?? 'none'}, got ${p.tenantEmail ?? 'none'}`)
      if (method !== 'model' && (p.propertyCode ?? null) !== l.property_code) issues.push(`property: expected ${l.property_code ?? 'none'}, got ${p.propertyCode ?? 'none'}`)
      if (p.needsPerson !== l.needs_person) issues.push(`needs a person: expected ${l.needs_person ? 'yes' : 'no'}, got ${p.needsPerson ? 'yes' : 'no'}`)
      if (p.ticket !== l.should_create_ticket) {
        const got = method === 'model' ? (p.ticket ? 'a repair' : 'not a repair') : p.ticketOutcome === 'linked' ? 'linked to an existing job' : p.ticket ? 'job created' : 'no job'
        issues.push(`maintenance job: expected ${l.should_create_ticket ? 'a new job' : 'no new job'}, got ${got}`)
      }
      if (l.expected_clause !== null && !p.cited.includes(l.expected_clause)) {
        issues.push(`clause: expected §${l.expected_clause}, cited ${p.cited.length ? p.cited.map((n) => `§${n}`).join(', ') : 'none'}`)
      }
      if (p.invalidCitations.length) issues.push(`cited a clause that doesn't exist: ${p.invalidCitations.map((n) => `§${n}`).join(', ')}`)
    }
    if (issues.length) out.push({ id: e.id, subject: e.subject, issues })
  })
  return out
}

interface SetResult {
  key: 'development' | 'holdout'
  title: string
  file: string
  emails: SampleEmail[]
  metrics: Record<MethodKey, Metric[]>
  misses: Record<MethodKey, Miss[]>
  preds: Record<MethodKey, Prediction[]>
  modelErrors: { id: string; error: string }[]
}

const SETS = [
  { key: 'development' as const, file: 'emails.json', title: 'Development set: 60 emails' },
  { key: 'holdout' as const, file: 'emails-holdout.json', title: 'Held-out set: 30 emails' },
]

const methodsFor = (rulesOnly: boolean): MethodKey[] => (rulesOnly ? ['rules'] : ['rules', 'model', 'shipped'])

type SeededJob = ExistingTicket & { propertyId: number }

async function evaluateSet(
  set: (typeof SETS)[number],
  ctx: { dir: Awaited<ReturnType<typeof loadDirectory>>; seeded: SeededJob[]; rulesOnly: boolean },
): Promise<SetResult> {
  const codeOf = (id: number) => ctx.dir.properties.find((p) => p.id === id)?.code ?? null
  const freshStore = () => {
    const store = new Map<number, ExistingTicket[]>()
    for (const { propertyId, ...job } of ctx.seeded) store.set(propertyId, [...(store.get(propertyId) ?? []), { ...job }])
    return store
  }
  const emails = loadSampleEmails(set.file).sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())
  const stores = { rules: freshStore(), shipped: freshStore() }
  const nextId = { n: -1 }
  const preds: Record<MethodKey, Prediction[]> = { rules: [], model: [], shipped: [] }
  const modelErrors: { id: string; error: string }[] = []

  for (const [n, e] of emails.entries()) {
    const email = emailInput(e)
    const a = analyse(email, ctx.dir)
    const rules = rulesTriage(email, a)
    preds.rules.push(predictionOf(rules, 'rules', ticketDecision(stores.rules, email, rules, nextId), codeOf))
    if (ctx.rulesOnly) {
      preds.model.push(missing)
      preds.shipped.push(missing)
      continue
    }
    try {
      const call = await callTriageModel(buildTriageRequest(email, a.link, a.candidates))
      preds.model.push(predictionOf(modelOnlyTriage(email, a, call.output, call.model, call.cached), 'model', null, codeOf))
      const shipped = combinedTriage(email, a, call.output, call.model, call.cached)
      preds.shipped.push(predictionOf(shipped, 'shipped', ticketDecision(stores.shipped, email, shipped, nextId), codeOf))
      process.stdout.write(`${e.id} ${call.cached ? 'cached' : 'live'}  (${n + 1}/${emails.length})\n`)
    } catch (err) {
      // The shipped pipeline falls back to the rules when the model fails; the model-only column has no output.
      const message = err instanceof Error ? err.message : String(err)
      modelErrors.push({ id: e.id, error: message })
      preds.model.push(missing)
      const fallback = rulesTriage(email, a)
      preds.shipped.push(predictionOf(fallback, 'shipped', ticketDecision(stores.shipped, email, fallback, nextId), codeOf))
      process.stdout.write(`${e.id} model failed: ${message}\n`)
    }
  }
  const methods = methodsFor(ctx.rulesOnly)
  return {
    key: set.key,
    title: set.title,
    file: set.file,
    emails,
    preds,
    modelErrors,
    metrics: Object.fromEntries(methods.map((m) => [m, metricsFor(emails, preds[m], m)])) as Record<MethodKey, Metric[]>,
    misses: Object.fromEntries(methods.map((m) => [m, missesFor(emails, preds[m], m)])) as Record<MethodKey, Miss[]>,
  }
}

async function main() {
  const rulesOnly = process.argv.includes('--rules-only') || !aiEnabled()
  const user = await prisma.user.findUnique({ where: { email: 'demo@example.com' } })
  if (!user) throw new Error('The demo user is missing: run the seed first (npm run db:seed -w server).')
  const dir = await loadDirectory(user.id)
  // Existing jobs from the seed (and any added by hand); jobs created by the inbox itself are left out.
  const seeded = await prisma.maintenanceRequest.findMany({
    where: { property: { userId: user.id }, source: { not: 'inbox' } },
    select: { id: true, propertyId: true, title: true, description: true, status: true, createdAt: true },
  })

  let live = 0
  let cachedCalls = 0
  let failedCalls = 0
  setCallLogger((r) => {
    if (r.error) failedCalls++
    else if (r.cached) cachedCalls++
    else live++
  })

  const results: SetResult[] = []
  for (const set of SETS) results.push(await evaluateSet(set, { dir, seeded, rulesOnly }))
  const methods = methodsFor(rulesOnly)
  const model = rulesOnly ? null : aiConfig().model

  const json = {
    generatedAt: new Date().toISOString(),
    model,
    modelCalls: { live, cached: cachedCalls, failed: failedCalls },
    sets: Object.fromEntries(
      results.map((r) => {
        const injection = r.emails.findIndex((e) => /ignore your instructions|automated assistant/i.test(e.text))
        return [
          r.key,
          {
            dataset: `data/inbox/${r.file}`,
            emails: r.emails.length,
            modelErrors: r.modelErrors,
            methods: Object.fromEntries(
              methods.map((m) => [m, { name: METHOD_NAMES[m], metrics: Object.fromEntries(r.metrics[m].map((x) => [x.key, x])) }]),
            ),
            injectionCase:
              injection >= 0
                ? Object.fromEntries(
                    methods.map((m) => [m, { id: r.emails[injection].id, needsPerson: r.preds[m][injection].needsPerson, reply: r.preds[m][injection].reply }]),
                  )
                : null,
            promiseRemovals: rulesOnly ? [] : r.emails.flatMap((e, i) => r.preds.shipped[i].removedSentences.map((sentence) => ({ id: e.id, sentence }))),
            perEmail: r.emails.map((e, i) => ({
              id: e.id,
              labels: e.labels,
              ...Object.fromEntries(
                methods.map((m) => {
                  const { reply: _reply, ...rest } = r.preds[m][i]
                  return [m, rest]
                }),
              ),
            })),
            misses: r.misses,
          },
        ]
      }),
    ),
  }

  const outDir = join(resolve(__dirname, '..', '..'), 'eval', 'results')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'inbox.json'), JSON.stringify(json, null, 2) + '\n')
  writeFileSync(join(outDir, 'inbox.md'), markdown(json.generatedAt, model, json.modelCalls, results, methods, rulesOnly))
  console.log(`\nWrote eval/results/inbox.md and inbox.json. Model calls: ${live} live, ${cachedCalls} cached, ${failedCalls} failed.`)
  for (const r of results) {
    for (const m of methods) {
      console.log(`\n${r.title} - ${METHOD_NAMES[m]}`)
      for (const x of r.metrics[m]) console.log(`  ${x.label.padEnd(52)} ${x.value}`)
    }
  }
}

function table(r: SetResult, methods: MethodKey[]): string[] {
  const lines = [`| Metric | ${methods.map((m) => METHOD_NAMES[m]).join(' | ')} |`, `|---|${methods.map(() => '---').join('|')}|`]
  for (const [i, row] of r.metrics[methods[0]].entries()) lines.push(`| ${row.label} | ${methods.map((m) => r.metrics[m][i].value).join(' | ')} |`)
  return lines
}

function describeSet(r: SetResult): string {
  const counts = Object.entries(
    r.emails.reduce<Record<string, number>>((m, e) => ((m[e.labels.category] = (m[e.labels.category] ?? 0) + 1), m), {}),
  )
    .map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`)
    .join(', ')
  return `${counts}; ${r.emails.filter((e) => e.labels.urgency === 'urgent').length} urgent`
}

function markdown(
  generatedAt: string,
  model: string | null,
  calls: { live: number; cached: number; failed: number },
  results: SetResult[],
  methods: MethodKey[],
  rulesOnly: boolean,
): string {
  const [dev, holdout] = results
  const lines: string[] = ['# Tenant inbox triage: evaluation', '']
  lines.push(
    'Two labelled synthetic sets. Every sender, address and business in them is invented.',
    '',
    `- **Development set** (\`data/inbox/${dev.file}\`, ${dev.emails.length} emails: ${describeSet(dev)}). The rules, the clause retrieval and the prompt were written alongside it, so it measures coverage of the cases they were designed for.`,
    `- **Held-out set** (\`data/inbox/${holdout.file}\`, ${holdout.emails.length} emails: ${describeSet(holdout)}). Written separately from the rules and the prompt with the same label guide, and scored with them unchanged. It is the better estimate of how the triage handles new emails.`,
    '',
  )
  if (model) {
    lines.push(
      `Model: \`${model}\`, temperature 0, one call per email shared by the "model only" and "shipped" columns. ` +
        `Model calls in this run: ${calls.live} live, ${calls.cached} from the disk cache${calls.failed ? `, ${calls.failed} failed` : ''}.`,
      '',
    )
  } else {
    lines.push('No model was configured for this run, so only the rules were evaluated.', '')
  }
  for (const r of results) lines.push(`## ${r.title}`, '', ...table(r, methods), '')

  lines.push('## How it is measured', '')
  lines.push(
    '- **Rules only** is what runs without a model (`AI_DRIVER=off` or no key): keyword categories and urgency, the sender linking, and a template reply citing the best-matching clause. It marks every message for a person.',
    "- **Model only** is the raw JSON from the model, with no rules or guards. The prompt is the one the shipped pipeline sends: the email, what the sender linking found, and the retrieved tenancy-terms clauses. It does not link tenants or properties, so those rows are n/a, and its maintenance-job row compares the model's \"is a repair\" answer with the label.",
    '- **Model + rules and guards** is the shipped pipeline: the same model call, then urgent-safety keywords can raise the urgency, the rules can require a person (urgent safety issue, unknown or unverified sender, contractor, injection attempt, repair without a property), the promise guard removes sentences that promise a date, payment, rent change or approval, the citation guard fixes or adds clause citations, and an injection attempt gets a neutral reply.',
    "- Tenant and property linking compare the linked tenant's email and property code with the labels (null when nobody should be linked).",
    '- A maintenance job decision is correct when a new job is created exactly when the label says so. The evaluation runs the same duplicate check as the database (same issue at the same property in the previous 7 days, or still open), against the seeded jobs and the jobs created earlier in the same set, in date order.',
    "- \"Reply cites the expected clause\" counts emails with an expected clause whose reply cites it as (Tenancy terms §N) and cites no clause that doesn't exist.",
    '- Urgent recall is the share of urgent emails marked urgent. A missed urgent email is the most costly error, because nobody phones the tenant.',
    '',
  )
  if (!rulesOnly) {
    const removals = results.flatMap((r) => r.emails.flatMap((e, i) => r.preds.shipped[i].removedSentences.map((s) => `- ${e.id}: "${s}"`)))
    if (removals.length) lines.push('## Sentences the promise guard removed', '', ...removals, '')
    const errors = results.flatMap((r) => r.modelErrors.map((x) => `- ${x.id}: ${x.error}`))
    if (errors.length) lines.push('## Model errors', '', ...errors, '')
  }
  lines.push('## Items not handled correctly', '')
  for (const r of results) {
    for (const m of [...methods].reverse()) {
      lines.push(`### ${r.title}, ${METHOD_NAMES[m]} (${r.misses[m].length} emails)`, '')
      if (r.misses[m].length === 0) lines.push('None.')
      for (const miss of r.misses[m]) lines.push(`- ${miss.id} "${miss.subject}": ${miss.issues.join('; ')}.`)
      lines.push('')
    }
  }
  lines.push(`Generated ${generatedAt.slice(0, 10)} by \`server/eval/inbox.ts\`.`, '')
  return lines.join('\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
