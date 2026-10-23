// Maintenance triage without a database: the rules on the labelled requests, the contractor ranking, the budget
// band and the draft work order. The safety requirement is checked on the development set the rules were written
// from; the evaluation report gives the held-out numbers.
import { describe, expect, it } from 'vitest'
import { loadRequests } from '../src/maintenance/demo'
import { accessNotesFrom, titleFor, triageByRules } from '../src/maintenance/rules'
import { budgetBand, draftWorkOrder, suggestContractors, type ContractorRow, type PastJob } from '../src/maintenance/workorder'

const requests = loadRequests()
const dev = requests.filter((r) => r.split === 'dev')

describe('triage rules', () => {
  it('has sixty labelled requests across both companies, twenty of them held out', () => {
    expect(requests).toHaveLength(60)
    expect(requests.filter((r) => r.split === 'heldout')).toHaveLength(20)
    expect(new Set(requests.map((r) => r.company))).toEqual(new Set(['acme', 'kestrel']))
    expect(new Set(requests.map((r) => r.id)).size).toBe(60)
  })

  it('flags every safety case in the development set as urgent, with the right flag', () => {
    for (const r of dev.filter((x) => x.labels.safety.length)) {
      const out = triageByRules({ text: r.text, photoNote: r.photoNote })
      expect(out.urgency, r.id).toBe('urgent')
      for (const flag of r.labels.safety) expect(out.safety, `${r.id} ${flag}`).toContain(flag)
    }
  })

  it('does not make a routine request urgent', () => {
    const routine = dev.filter((x) => !x.labels.safety.length)
    const wrong = routine.filter((r) => triageByRules({ text: r.text, photoNote: r.photoNote }).urgency === 'urgent')
    expect(wrong.map((r) => r.id)).toEqual([])
  })

  it('gets the category right on at least 95% of the development set', () => {
    const right = dev.filter((r) => triageByRules({ text: r.text, photoNote: r.photoNote }).category === r.labels.category)
    expect(right.length / dev.length).toBeGreaterThanOrEqual(0.95)
  })

  it('reads the common safety phrasings', () => {
    const cases: [string, string, string][] = [
      ['I can smell gas in the hallway', 'gas_heating', 'gas'],
      ['The socket is sparking and smells of burning', 'electrical', 'electrical'],
      ['Water is pouring through the ceiling', 'water_leak', 'flooding'],
      ['The light fitting is dripping water', 'water_leak', 'flooding'],
      ['The front door will not lock', 'security', 'security'],
      ['Someone broke into the flat last night and the door is smashed', 'security', 'security'],
      ['A pipe in the bathroom has burst', 'water_leak', 'flooding'],
      ['The carbon monoxide alarm keeps going off', 'gas_heating', 'gas'],
    ]
    for (const [text, category, flag] of cases) {
      const out = triageByRules({ text })
      expect(out.category, text).toBe(category)
      expect(out.urgency, text).toBe('urgent')
      expect(out.safety, text).toContain(flag)
    }
    // A smoke alarm is not smoke, and an oven door is not a security door.
    expect(triageByRules({ text: 'The smoke alarm keeps chirping' }).safety).toEqual([])
    expect(triageByRules({ text: "The oven door won't close" }).category).toBe('appliance')
  })

  it('lets the tenant raise or lower routine urgency, but never lower a safety case', () => {
    expect(triageByRules({ text: 'The tap drips, no rush at all.' }).urgency).toBe('low')
    expect(triageByRules({ text: 'The tap is dripping and we have a newborn, please come urgently.' }).urgency).toBe('high')
    expect(triageByRules({ text: 'Smell of gas but no rush, whenever suits.' }).urgency).toBe('urgent')
  })

  it('writes a title and picks out access notes', () => {
    expect(titleFor('Hi there, the kitchen tap is dripping all night. Thanks!', 'plumbing')).toBe('The kitchen tap is dripping all night')
    expect(titleFor('ok', 'pest')).toBe('Pests')
    expect(accessNotesFrom("The tap drips. I'm home after 5pm most days.")).toBe("I'm home after 5pm most days")
    expect(accessNotesFrom('Key is with the neighbour at number 16 if nobody is in.')).toContain('Key is with the neighbour')
    expect(accessNotesFrom('The tap drips.')).toBeNull()
  })
})

const contractors: ContractorRow[] = [
  { id: 1, name: 'Acme Plumbing', trade: 'plumbing', available: true, availableFrom: null, notes: 'After-hours call-outs' },
  { id: 2, name: 'Acme Roofing', trade: 'roofing', available: false, availableFrom: new Date('2026-10-12'), notes: null },
  { id: 3, name: 'Acme Electrical', trade: 'electrical', available: true, availableFrom: null, notes: null },
  { id: 4, name: 'Acme Gas & Heating', trade: 'gas_heating', available: true, availableFrom: null, notes: null },
]
const jobs: PastJob[] = [
  { contractorId: 1, category: 'plumbing', cost: 220, quoteAmount: 220, status: 'completed' },
  { contractorId: 1, category: 'plumbing', cost: 190, quoteAmount: 190, status: 'completed' },
  { contractorId: 1, category: 'water_leak', cost: 650, quoteAmount: 650, status: 'completed' },
  { contractorId: 2, category: 'water_leak', cost: 720, quoteAmount: 720, status: 'completed' },
  { contractorId: 3, category: 'electrical', cost: 285, quoteAmount: 285, status: 'completed' },
  { contractorId: 1, category: 'plumbing', cost: null, quoteAmount: 480, status: 'in_progress' },
]

describe('contractor suggestion and work order', () => {
  it('ranks the right trade first, available before unavailable, with past similar jobs', () => {
    const leak = suggestContractors('water_leak', contractors, jobs, new Date('2026-09-20'))
    expect(leak.map((c) => c.name)).toEqual(['Acme Plumbing', 'Acme Roofing'])
    expect(leak[0].why).toContain('available now')
    expect(leak[0].similarJobs).toBe(1)
    expect(leak[1].why).toContain('back on 2026-10-12')
    expect(suggestContractors('pest', contractors, jobs)).toEqual([])
    const gas = suggestContractors('gas_heating', contractors, jobs)
    expect(gas[0].name).toBe('Acme Gas & Heating')
    expect(gas[1].name).toBe('Acme Plumbing')
  })

  it('draws the budget band from similar completed jobs, falling back to the trade and then everything', () => {
    const plumbing = budgetBand('plumbing', jobs, contractors, 'NZD')
    expect(plumbing).toMatchObject({ low: 200, high: 210, basis: '2 completed plumbing jobs', sampleSize: 2 })
    const gas = budgetBand('gas_heating', jobs, contractors, 'NZD')
    expect(gas?.basis).toContain('gas heating or plumbing contractors')
    expect(budgetBand('pest', jobs, contractors, 'NZD')?.basis).toBe('5 completed jobs of any kind')
    expect(budgetBand('pest', [], contractors, 'NZD')).toBeNull()
  })

  it('drafts a work order with scope, access, safety notes, budget and contractor', () => {
    const triage = triageByRules({ text: "A pipe under the sink has burst and water is everywhere. I'm home all day, dog is friendly." })
    const order = draftWorkOrder({ triage, property: { code: 'MTE14', address: '14 Kowhai Road', suburb: 'Mount Eden' }, tenant: { name: 'Aroha Ngata', phone: '021 555 0100' }, contractors, jobs, currency: 'NZD', now: new Date('2026-09-20') })
    expect(order.status).toBe('draft')
    expect(order.urgency).toBe('urgent')
    expect(order.scope).toContain('14 Kowhai Road, Mount Eden (MTE14)')
    expect(order.accessNotes).toContain("I'm home all day")
    expect(order.accessNotes).toContain('021 555 0100')
    expect(order.safetyNotes.join(' ')).toContain('mains')
    expect(order.contractor?.name).toBe('Acme Plumbing')
    expect(order.budget).toMatchObject({ low: 670, high: 700, currency: 'NZD' })
  })
})
