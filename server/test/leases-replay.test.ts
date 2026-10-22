// The model and hybrid routes replayed from the committed reply cache (data/leases/model-cache): no key, no network.
// A request that was never recorded is an error, so a prompt or schema change without a re-recorded cache fails here.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AiError, aiEnabled } from '../src/ai/llm'
import { sameTermValue } from '../src/leases/compare'
import { modelExtract } from '../src/leases/model'
import { abstractLease } from '../src/leases/pipeline'
import { pdfPages } from '../src/leases/text'
import { TERM_FIELDS } from '../src/leases/types'

const DATA = resolve(__dirname, '../../data/leases')
const truth = JSON.parse(readFileSync(join(DATA, 'truth.json'), 'utf8')) as { leases: { file: string; fields: Record<string, unknown>; risks: string[] }[] }
const heldout = JSON.parse(readFileSync(join(DATA, 'heldout', 'truth.json'), 'utf8')) as { leases: { file: string; fields: Record<string, unknown>; risks: string[] }[] }

const saved = { driver: process.env.AI_DRIVER, key: process.env.AI_API_KEY }
beforeAll(() => {
  process.env.AI_DRIVER = 'replay'
  delete process.env.AI_API_KEY
})
afterAll(() => {
  process.env.AI_DRIVER = saved.driver
  if (saved.key !== undefined) process.env.AI_API_KEY = saved.key
})

describe('replay mode', () => {
  it('counts as enabled without a key and refuses to call the network', async () => {
    expect(aiEnabled()).toBe(true)
    await expect(modelExtract([{ num: 1, text: 'A request that was never recorded.' }], 'NZ', 'commercial')).rejects.toBeInstanceOf(AiError)
  })

  it('replays the model route for a UK commercial lease with a quote and page per term', async () => {
    const doc = truth.leases.find((l) => l.file === 'lease-c-uk-01.pdf')!
    const pages = await pdfPages(readFileSync(join(DATA, doc.file)))
    const a = await abstractLease(pages, 'llm')
    expect(a.model.cached).toBe(1)
    expect(a.model.live).toBe(0)
    for (const f of TERM_FIELDS) expect(sameTermValue(f, doc.fields[f], (a.terms as unknown as Record<string, unknown>)[f]), f).toBe(true)
    expect(a.extracted.rentAmount.page).toBe(1)
    expect(a.extracted.rentAmount.quote).toContain('10,500')
    expect(a.risks.map((r) => r.code).sort()).toEqual([...doc.risks].sort())
  })

  it('replays the hybrid route for a held-out narrative lease, with high confidence where the rules agree', async () => {
    const doc = heldout.leases.find((l) => l.file === 'lease-h-us-01.pdf')!
    const pages = await pdfPages(readFileSync(join(DATA, 'heldout', doc.file)))
    const a = await abstractLease(pages, 'hybrid')
    expect(a.model.live).toBe(0)
    expect(a.country).toBe('US')
    for (const f of TERM_FIELDS) expect(sameTermValue(f, doc.fields[f], (a.terms as unknown as Record<string, unknown>)[f]), f).toBe(true)
    // The rules read the currency of a narrative lease (and agree) but not its reference: high versus medium.
    expect(a.extracted.currency.confidence).toBe('high')
    expect(a.extracted.leaseRef.confidence).toBe('medium')
    expect(a.charges.filter((c) => c.kind === 'rent')).toHaveLength(12)
    expect(a.risks.map((r) => r.code).sort()).toEqual([...doc.risks].sort())
  })

  it('sends a model-rules disagreement to a person on the hybrid route', async () => {
    const pages = await pdfPages(readFileSync(join(DATA, 'lease-c-nz-02.pdf')))
    const a = await abstractLease(pages, 'hybrid')
    expect(a.model.repaired).toBe(true)
    expect(a.extracted.insurance.status).toBe('needs_person')
    expect(a.issues.some((i) => i.code === 'rules_disagree' && i.field === 'insurance')).toBe(true)
  })
})
